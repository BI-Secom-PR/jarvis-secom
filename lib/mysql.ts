import mysql from 'mysql2/promise';
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls';

// OCI MySQL HeatWave DB system auto-generates a self-signed CA (CN=MySQL_Endpoint_CA),
// not present in any public trust store. We pin it so the TLS connection is actually
// authenticated (rejectUnauthorized:true) instead of just encrypted — closes MITM
// credential capture. Public by design, safe to commit.
// NOTE: OCI regenerates this CA (e.g. maintenance/restart — last seen 2026-09-03);
// symptom is "certificate signature failure". Prefer MYSQL_CA env (Vercel) so prod
// can rotate without a code change; this PEM is the fallback. Refresh with:
//   echo | openssl s_client -starttls mysql -connect $MYSQL_HOST:3306 -showcerts
// SHA256 fingerprint: 64:6D:C4:55:94:03:08:0C:D3:8C:ED:88:36:EB:13:C3:AC:2E:03:E6:9A:C6:8A:47:13:AE:D3:06:89:40:A4:0F
const OCI_MYSQL_CA = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIUJCE+vt1FIpdbBJ3jK9Ks0eow3XswDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRTXlTUUxfRW5kcG9pbnRfQ0EwHhcNMjYwOTAzMDQ1NTUw
WhcNMjkwOTAyMDQ1NTUwWjAcMRowGAYDVQQDDBFNeVNRTF9FbmRwb2ludF9DQTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAJyxcMOZMF7HuVVGCqd6YZ47
HdepFTXImj0c7E2HVX4yw5ZRbpdbqxUt6gI7IawWmVaaoj3y/NwGwMN8YFcco0Et
LQ65sBOZ4TYJXpO3ZH0uHcgu1H5IV4Uo9qtHqcI3XGzvtYNK1H7ZY5E0f+DlNoEQ
qoJN1Gf48XwnD0a9a960HWegYKrBqAwremf1elcTDfZEg5sRRyaJ6RaISvkTNDiY
05OpWFl71IW2m8EYyFt8zpYz421m4+2rlOnUjRjiE6kz0+VfL1xzPGomT3cTezrR
n2dcWXrPQ0QR7X3Lj2UkIpu5d9WQRAj+Qq6dgBX6fglv15zJDt9gPXSbL6BTnA0C
AwEAAaNTMFEwHQYDVR0OBBYEFLYXt78xpI/RnhW4ihkI+qzzzyyPMB8GA1UdIwQY
MBaAFLYXt78xpI/RnhW4ihkI+qzzzyyPMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBADtiGTcCYLaoQTFWpHuMMfLnKQU4GJyDCKwaJnSlAuHXovAD
vQ9yKUidGKSR3i2+kiJxF21PaKIm0AvY0KrArqytX6Orh0QcF86VnnyAJPQFHrdo
ft7qm789mgc7g4ZnhFPoxfVd/YHC8XmBYgBLVuZ+LELakBuvIZDG4X9tfqGovjdo
c734j2e1CNsLFtjVwE+2c8XOwvAGp/HN05Fp7bQrGo6h8c4KVPwJ2LxZoMqPqPC2
0YahdmBXCsn2JIOXc85dA08gSLMVtXAPXFh1bqsZeokvjMhHihwuxYFPYKXENxmw
HCQNzrfUpgrUHj2I4agcnCd28uQ6I620mlEg6GY=
-----END CERTIFICATE-----`;

function mysqlCa(): string {
  const fromEnv = process.env.MYSQL_CA?.trim();
  if (fromEnv) return fromEnv.replace(/\n/g, '
');
  return OCI_MYSQL_CA;
}

let pool: mysql.Pool | null = null;
let rwPool: mysql.Pool | null = null;
let poolResetAt = 0;
let rwPoolResetAt = 0;

// Cert has a generic CN (MySQL_Endpoint_Server), no SAN, and we connect by IP —
// hostname verification can't pass. Skip the hostname check while keeping full
// CA-chain verification (that's what stops MITM). mysql2 forwards these to
// tls.connect at runtime, but its SslOptions type omits checkServerIdentity —
// hence the TLS type + cast.
const sslOptions: TlsConnectionOptions = {
  ca: mysqlCa(),
  rejectUnauthorized: true,
  checkServerIdentity: () => undefined,
};

const FATAL_CONN_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'POOL_CLOSED',
  'HANDSHAKE_SSL_ERROR',
]);

// filters + data often fail together; don't thrash recreate/end on every sibling 503.
const RESET_COOLDOWN_MS = 3_000;
// Delay end() so concurrent in-flight queries on the old pool aren't killed mid-request.
const POOL_END_GRACE_MS = 15_000;

function basePoolOptions() {
  return {
    host: process.env.MYSQL_HOST?.trim(),
    database: process.env.MYSQL_DATABASE?.trim(),
    waitForConnections: true,
    // Fail faster than the default ~10s hang and recycle half-open sockets.
    connectTimeout: 8_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    ssl: sslOptions as mysql.SslOptions,
  } as const;
}

function createReadPool(): mysql.Pool {
  return mysql.createPool({
    ...basePoolOptions(),
    user: process.env.MYSQL_USER?.trim(),
    password: process.env.MYSQL_PASSWORD?.trim(),
    // filters + data waves can overlap; 5 was too tight and queued to timeout.
    connectionLimit: 10,
  });
}

function createRwPool(): mysql.Pool {
  return mysql.createPool({
    ...basePoolOptions(),
    user: process.env.MYSQL_RW_USER!.trim(),
    password: process.env.MYSQL_RW_PASSWORD!.trim(),
    connectionLimit: 2,
  });
}

function retirePool(old: mysql.Pool | null) {
  if (!old) return;
  // Never end() synchronously: sibling routes (filters/data) share this pool and
  // would immediately fail with "Pool is closed" — which then looked like permanent 500s.
  setTimeout(() => {
    void old.end().catch(() => undefined);
  }, POOL_END_GRACE_MS);
}

/** True when the pool should be thrown away rather than reused. */
export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  const message = 'message' in err ? String((err as { message?: unknown }).message ?? '') : '';
  if (FATAL_CONN_CODES.has(code)) return true;
  // mysql2 sometimes surfaces this only as a message after pool.end().
  return /pool is closed/i.test(message);
}

/**
 * Drop the shared read pool so the next getPool() rebuilds connections.
 * Safe under concurrent filters/data failures: cooldown + delayed end().
 */
export function resetPool(): void {
  const now = Date.now();
  if (now - poolResetAt < RESET_COOLDOWN_MS) return;
  poolResetAt = now;
  const old = pool;
  pool = null;
  retirePool(old);
}

/** Drop the write pool so the next getRwPool() rebuilds connections. */
export function resetRwPool(): void {
  const now = Date.now();
  if (now - rwPoolResetAt < RESET_COOLDOWN_MS) return;
  rwPoolResetAt = now;
  const old = rwPool;
  rwPool = null;
  retirePool(old);
}

export function getPool(): mysql.Pool {
  if (!pool) pool = createReadPool();
  return pool;
}

/**
 * Write-capable pool for the sentiment-correction path only. The MYSQL_RW_*
 * user is granted UPDATE solely on silver_social_comments — the main pool
 * (and the AI SQL path) stays read-only. Returns null when the env is not
 * configured so callers can answer 503 instead of crashing.
 */
export function getRwPool(): mysql.Pool | null {
  if (!process.env.MYSQL_RW_USER || !process.env.MYSQL_RW_PASSWORD) return null;
  if (!rwPool) rwPool = createRwPool();
  return rwPool;
}
