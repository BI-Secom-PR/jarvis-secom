/**
 * Live check for the OCI CA self-heal path in lib/mysql.ts.
 *
 *   npx tsx --env-file=.env.local scripts/test-mysql-ca-heal.ts
 *
 * Forces a stale CA (an old rotated-out OCI cert) so the first query fails with
 * HANDSHAKE_SSL_ERROR, then asserts isTransientDbError() triggers healCa(), which
 * re-pins the live CA so a retry succeeds. Also checks the happy path.
 */
import assert from 'node:assert';

// A genuine but rotated-out OCI CA (fingerprint B4:07:00:… — valid 2026-07-30).
const STALE_CA = `-----BEGIN CERTIFICATE-----
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

process.env.MYSQL_CA = STALE_CA;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { getPool, resetPool, isTransientDbError } = await import('../lib/mysql');

  // 1. Stale CA -> handshake fails -> classified transient (which fires healCa).
  let firstErr: unknown;
  try {
    await getPool().query('SELECT 1');
    assert.fail('expected the stale CA to break the TLS handshake');
  } catch (e) {
    firstErr = e;
  }
  assert.equal((firstErr as { code?: string }).code, 'HANDSHAKE_SSL_ERROR', 'wrong failure code');
  assert.equal(isTransientDbError(firstErr), true, 'CA error must classify as transient');
  resetPool();
  console.log('✓ stale CA fails with HANDSHAKE_SSL_ERROR and is classified transient');

  // 2. healCa runs async — give it a beat, then a retry must succeed.
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    await sleep(1500);
    try {
      const [rows] = await getPool().query('SELECT 1 AS ok');
      ok = Array.isArray(rows) && (rows[0] as { ok: number }).ok === 1;
    } catch {
      resetPool();
    }
  }
  assert.equal(ok, true, 'retry after healCa should reconnect against the live CA');
  console.log('✓ self-heal re-pinned the live CA; retry query succeeded');

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
