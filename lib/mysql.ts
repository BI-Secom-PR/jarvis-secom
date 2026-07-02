import mysql from 'mysql2/promise';
import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls';

// OCI MySQL HeatWave DB system auto-generates a self-signed CA (CN=MySQL_Endpoint_CA),
// not present in any public trust store. We pin it so the TLS connection is actually
// authenticated (rejectUnauthorized:true) instead of just encrypted — closes MITM
// credential capture. Public by design, safe to commit.
// NOTE: OCI regenerates this CA (e.g. maintenance/restart — last seen 2026-07-02);
// symptom is "certificate signature failure" in chat. Re-pin with:
//   echo | openssl s_client -starttls mysql -connect $MYSQL_HOST:3306 -showcerts
// SHA256 fingerprint: 69:D0:ED:76:8E:BB:97:39:14:01:B2:BA:76:3E:82:92:4A:58:47:97:99:38:18:9A:0B:06:9D:03:6B:BA:0C:A2
const OCI_MYSQL_CA = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIURetR9lydHH7HuQb1JI5jcd0B2bEwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRTXlTUUxfRW5kcG9pbnRfQ0EwHhcNMjYwNzAyMDUwNjE5
WhcNMjkwNzAxMDUwNjE5WjAcMRowGAYDVQQDDBFNeVNRTF9FbmRwb2ludF9DQTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMTJ7oEz5yOxWVxyxc27iZPS
rveGSdmzItHGL3V8K4FTdtVJ9g+xhUzEPqkuToGvm4puQcb+n/DfMQoYl0NfX4se
pID7g4etjmC6uiP52thxKuPN6gn+HNEsHyc0WyO7N/6pXmw/iPCw0p7Jrkwqd57u
bNVr5iYonyumndEYdgF1Qp4781Z6ulv5rFlX2d9MSpyxS3sDpANjYbtbvIQuU4YE
HCi1GhVkDjcJ1Rk/MHsZkBEzMcfwiE61RomKVwGEt6SxNT61odzTwOA1Wc/GIf4d
1jucM2RZ4kVBCmzsBGQE5Mo92K2/FiPd1itL7bziJXtZXNVGRmm7aiFtzOk5KiMC
AwEAAaNTMFEwHQYDVR0OBBYEFM9HfHyhdjuOEmPeY9yMnzfhnJQSMB8GA1UdIwQY
MBaAFM9HfHyhdjuOEmPeY9yMnzfhnJQSMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBABwEDyrA8Zrg9yzXLDLQGCmCjzmZoFLs9KjKJJXfeZHaqBE4
vEZZ78z99dmjLQRI8Y5fhWPN4aYpwdVO2LAodCtc3dVJMgbS9F9fOssSIuM9KZ3j
dMAk4/TWmrDs4NgpkXnEwjTL5X4WfYmZItN/AcchPfshTRkI0y2m1jYs41j6YuxL
xtQB1/w4thWOQgdV4nt0kOFCHg74MxEdIIDYbWEDXhW+ddTUsxOjQ85KgbEEx19n
Yhnz/YJfAW8M2I9C7qqiW0tbT+DDj9KRuB8v7qq4d85f1p0wxI6SLWH5X8lUuzt0
RK3zVZ5mjoaJ/SbfBxJE+vxpivaqhuINltt/Nqo=
-----END CERTIFICATE-----`;

let pool: mysql.Pool | null = null;

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

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST?.trim(),
      database: process.env.MYSQL_DATABASE?.trim(),
      user: process.env.MYSQL_USER?.trim(),
      password: process.env.MYSQL_PASSWORD?.trim(),
      waitForConnections: true,
      connectionLimit: 5,
      ssl: sslOptions as mysql.SslOptions,
    });
  }
  return pool;
}
