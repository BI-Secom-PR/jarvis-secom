import mysql from 'mysql2/promise';
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls';

// OCI MySQL HeatWave DB system auto-generates a self-signed CA (CN=MySQL_Endpoint_CA),
// not present in any public trust store. We pin it so the TLS connection is actually
// authenticated (rejectUnauthorized:true) instead of just encrypted — closes MITM
// credential capture. Public by design, safe to commit.
//
// OCI regenerates this CA on maintenance/restart (~monthly; seen 2026-06-04, 07-02,
// 07-30, 09-03, 10-01, 10-29). Symptom: "certificate signature failure" / code HANDSHAKE_SSL_ERROR.
// Two recovery layers now cover a rotation without a code change:
//   1. MYSQL_CA env var overrides this committed default (paste new PEM in Vercel, redeploy).
//   2. healCa() below re-reads the live CA from the endpoint on the first failed query
//      and hot-swaps it — no deploy, self-heals within one retry.
// This constant is just the first-boot default. Re-pin (or refresh MYSQL_CA) with:
//   echo | openssl s_client -starttls mysql -connect $MYSQL_HOST:3306 -showcerts
// SHA256 fingerprint: 8C:CF:07:5A:04:27:69:C7:CC:A2:02:AE:4E:CD:88:46:24:17:70:6F:D6:32:60:3F:94:8C:44:BC:DA:15:3A:F0
const OCI_MYSQL_CA = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIUSSXWxxzeKTQv+rzXiv3yzgYG4kcwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRTXlTUUxfRW5kcG9pbnRfQ0EwHhcNMjYxMDI5MDQ1NjI4
WhcNMjkxMDI4MDQ1NjI4WjAcMRowGAYDVQQDDBFNeVNRTF9FbmRwb2ludF9DQTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMopTwZba09DAm9wabAeVAbG
SBmvT14KDvsrDKr3iSqIfglL8Oce1fOve4uMdbJmquSPTXMC0+0SPbVS3teBeoBw
BuxrSpdWOQltUNSbpBcVivVVCbaWso3yeFLhbXrRlZfHIqQNB7lwOatc9+piqyBc
GYTga/KPDyTmvawQR7/I9ctnQlybWL0Ua2RQBlmwZ7Z2cJnhtMEKdOqg60GW+RiF
c+5W6s/1ir3Hec8STjvGVY3fH+waoQZGp7StyJaGQbEp8PaHN/1PLpIdok0LLVib
E+8uTldz3/2qZJA62Pe/oJzaFNL8uJC4qxGZZZpAOzkvQmB6FMPOf4pFY22LOV0C
AwEAAaNTMFEwHQYDVR0OBBYEFJ/D48RJhr2TabRxmaQuvn5ywa0kMB8GA1UdIwQY
MBaAFJ/D48RJhr2TabRxmaQuvn5ywa0kMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAEC+PmXq01gifDjLwgC3V7Iwhjdjgqa6g8Bt3bHgehFClR0Q
imrqDuR8NqlZvUo9vZKAI3GhhKhm+rtCo/TCtqfNx5LrzZp14vtsNQ/TX6ROX1e7
GsG4twGDVY/rawDnwUahtlrcJ7t4a0UrM72z+kz9AtzSlcFz7SK5c29Ysk/XfSkw
/RxqbnNeWYxe8NsUdaoNZwuU5ke3klhx6I2fwhGptMP2uvTxFVZu9z+6XBd201Vy
cjbvDJ8n5eC501X3yyhh5RFr7gq74VovEGI0JeH/DJbbqPYXgYNVQNcofSr2hO6h
ZgSDM4XoH7lTfLRHu9r+yFXHv/X017VVqw1XTys=
-----END CERTIFICATE-----`;

let pool: mysql.Pool | null = null;
let rwPool: mysql.Pool | null = null;
let poolResetAt = 0;
let rwPoolResetAt = 0;

// Live trust anchor: MYSQL_CA env override wins, else the committed default.
// healCa() mutates this in place on a rotation.
let caPem = process.env.MYSQL_CA?.trim() || OCI_MYSQL_CA;

// Cert has a generic CN (MySQL_Endpoint_Server), no SAN, and we connect by IP —
// hostname verification can't pass. Skip the hostname check while keeping full
// CA-chain verification (that's what stops MITM). mysql2 forwards these to
// tls.connect at runtime, but its SslOptions type omits checkServerIdentity —
// hence the TLS type + cast. Rebuilt per pool so a healed caPem takes effect.
function sslOptions(): TlsConnectionOptions {
  return {
    ca: caPem,
    rejectUnauthorized: true,
    checkServerIdentity: () => undefined,
  };
}

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
    ssl: sslOptions() as mysql.SslOptions,
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
  // OCI rotated its self-signed CA. Kick a live re-fetch; the pool reset that the
  // caller does next (plus the one healCa does on success) rebuilds against it.
  if (code === 'HANDSHAKE_SSL_ERROR') {
    void healCa();
    return true;
  }
  // mysql2 sometimes surfaces this only as a message after pool.end().
  return /pool is closed/i.test(message);
}

const CA_HEAL_COOLDOWN_MS = 30_000;
let caHealAt = 0;
let caHealing: Promise<void> | null = null;

function pemFromDer(der: Buffer): string {
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`;
}

/**
 * Re-read the endpoint's current self-signed CA and hot-swap `caPem` so pools
 * rebuild against it. The peek connects with rejectUnauthorized:false — the only
 * unauthenticated exposure is this one throwaway connection, and only during the
 * seconds after a rotation. Single-flight + 30s cooldown so a wave of failing
 * queries doesn't spawn a wave of peek connections (or thrash on a bad fetch).
 */
async function healCa(): Promise<void> {
  if (caHealing) return caHealing;
  if (Date.now() - caHealAt < CA_HEAL_COOLDOWN_MS) return;
  caHealAt = Date.now();
  caHealing = (async () => {
    let conn: mysql.Connection | null = null;
    try {
      conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST?.trim(),
        user: process.env.MYSQL_USER?.trim(),
        password: process.env.MYSQL_PASSWORD?.trim(),
        ssl: { rejectUnauthorized: false },
        connectTimeout: 8_000,
      });
      const core = conn as unknown as { connection?: { stream?: unknown }; stream?: unknown };
      const sock = (core.connection?.stream ?? core.stream) as
        | { getPeerCertificate?: (detailed: boolean) => PeerCert | undefined }
        | undefined;
      let cert = sock?.getPeerCertificate?.(true);
      const seen = new Set<string>();
      while (cert?.issuerCertificate && cert.issuerCertificate !== cert && !seen.has(cert.fingerprint256)) {
        seen.add(cert.fingerprint256);
        cert = cert.issuerCertificate;
      }
      const fresh = cert?.raw ? pemFromDer(cert.raw) : '';
      if (fresh && fresh !== caPem) {
        caPem = fresh;
        console.warn('[mysql] OCI CA rotated — re-pinned live from endpoint. Set MYSQL_CA to persist across cold starts.');
        resetPool();
        resetRwPool();
      }
    } catch (e) {
      console.error('[mysql] healCa failed', e);
    } finally {
      await conn?.end().catch(() => undefined);
      caHealing = null;
    }
  })();
  return caHealing;
}

interface PeerCert {
  raw?: Buffer;
  fingerprint256: string;
  issuerCertificate?: PeerCert;
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
