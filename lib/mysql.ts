import mysql from 'mysql2/promise';
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls';

// OCI MySQL HeatWave DB system auto-generates a self-signed CA (CN=MySQL_Endpoint_CA),
// not present in any public trust store. We pin it so the TLS connection is actually
// authenticated (rejectUnauthorized:true) instead of just encrypted — closes MITM
// credential capture. Public by design, safe to commit.
// NOTE: OCI regenerates this CA (e.g. maintenance/restart — last seen 2026-07-30);
// symptom is "certificate signature failure" in chat. Re-pin with:
//   echo | openssl s_client -starttls mysql -connect $MYSQL_HOST:3306 -showcerts
// SHA256 fingerprint: B4:07:00:6D:E1:B0:66:80:44:1D:FC:69:C0:E8:F8:44:A5:08:85:61:85:8B:24:AE:DF:59:D8:FD:7C:87:BA:7B
const OCI_MYSQL_CA = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIUHWkdj7Ru8BNRRGTLFmCViY7Nw3QwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRTXlTUUxfRW5kcG9pbnRfQ0EwHhcNMjYwNzMwMDQ1ODQx
WhcNMjkwNzI5MDQ1ODQxWjAcMRowGAYDVQQDDBFNeVNRTF9FbmRwb2ludF9DQTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKyCX5hLYeCWjfinqVqdBmLZ
AC86DQTR19FhIfuNSakiPrwDP97ohu40wi8P0DYQQm4igUQC253NVyDx+iQB2OVS
X+vPeTvXUhdmzKiD9jtJ5MKCTjSVKWCyxUNmW/MxxSvVEgjYUtY/qPFMLQQVt/T+
9ganEkqlHPsDGAAusIIxelyKle5p3dwcUJKiMRtgT3Osp2tsbPidyQZxbJFa3NgC
12UBBJIVO+kHwvnPpIzIOgoYcCeZdcAHO4DWVXjaND7Fl3562HLef/WOi3sTjtWV
XxGPrO61O/+uq1PuXvNUlImVJTaPhDyQX5pobsbITojqznh/m/Yb9F6Be3xIZ2sC
AwEAAaNTMFEwHQYDVR0OBBYEFLbcFjYtrjJbvq6fG9OFauNc21AHMB8GA1UdIwQY
MBaAFLbcFjYtrjJbvq6fG9OFauNc21AHMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAEmR/H9Pi2gZ+EELTQWlTbkLMZh33kym/KvPJ+p4lLPL5Ht4
Om8zH0jN1QLvF/U725gGJK2eHOIV09qkofRG7ZIWAZZhAX72Kuv5ImzcROPoQlvy
+wRvxFQuZx4TW6iH46ft1PDHER6KpfovGmsAv1Fduh2JPAMV2a8wJGs5KrQscXer
Ht5yMEh02vaSZd3xJ/h4ZgTdcEaEJ+D3SjZ1t6Iv2gtJ0gjXpQoGzYy9hHUpFLlU
twBzUumQ4PngfJf4bjZefaAqvLjHhd3uqkqIETlHXksrobhrbb9rEDhr2U5ZnIuW
xjjysIN+5fQzEQQ3QaIXWKZgXs8submFihsqLCk=
-----END CERTIFICATE-----`;

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
  ca: OCI_MYSQL_CA,
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
