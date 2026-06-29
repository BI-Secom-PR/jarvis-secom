import mysql from 'mysql2/promise';

// OCI MySQL HeatWave DB system auto-generates a self-signed CA (CN=MySQL_Endpoint_CA),
// not present in any public trust store. We pin it so the TLS connection is actually
// authenticated (rejectUnauthorized:true) instead of just encrypted — closes MITM
// credential capture. Public by design, safe to commit.
// SHA256 fingerprint: 74:A7:4B:CD:3C:30:E1:83:43:83:FE:74:62:51:DC:61:05:66:06:D7:B6:38:74:5A:97:E2:9D:88:A3:AD:42:77
const OCI_MYSQL_CA = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIUUlAew7e+CausQ9PelxJRVEhSfkUwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRTXlTUUxfRW5kcG9pbnRfQ0EwHhcNMjYwNjA0MDUxNzE4
WhcNMjkwNjAzMDUxNzE4WjAcMRowGAYDVQQDDBFNeVNRTF9FbmRwb2ludF9DQTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK5vSLfV6Fg6jepfi+uH205e
HMI6SZTfjhtlzv+Vfz4PuG6SNTeOk2l1ARNmvI188UuPWURGdVjo0IN5nzfZ6OCt
9m9/lvww19VezsuRZ0EeTKiPT9CRkEI/nGoTNs7kwafQJGf+eELywI3S+PCCEvMB
kjLFKhGv4AeOsYXxrb2aA7/tJFP8Xb+mnN0eI4zvPCXG63+S9pSaZNtIpJbgpKLG
gi8wi0tWbk6KDcuI4e2JD9iQpDyiNzLUQl3FbinAgm8r9VGMcn234W1/WChNae2J
FhfOVVw7R5uBLQAN+hM1W0riMMEtLUqGoVzzRhYF3odwfS6sWK/zLfx/U7qkRqEC
AwEAAaNTMFEwHQYDVR0OBBYEFEoQJybOfcxkLVM1zaz2QY+wZgxMMB8GA1UdIwQY
MBaAFEoQJybOfcxkLVM1zaz2QY+wZgxMMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAJxh5RblocE5w1LOl9wphV4UZtjr1/aPsw+4snMAPB9Z07yk
Cs9OobcXTzLaWHMeIQ0mERp+ShrKZ19hMSduda8AKwj203WHi20AJC9aV9XsoIDs
YoAqt9acsn4PcMcAkMp4T3VybyNhir9zu6zmSNetOElvfra4HYhg7mtnr9hFAcbe
xtC7niM0/em1FOnL870yiVjajdOmS5oEruWT0vyPUD/Sc6cnXlzSAl5dy8eLwCS8
W/afX8dJuz+4+NJddhWTkmzDGr6Qku+wrAiNJ5OGEpjJiSGPQuGuUT4GYGOSzMUm
odhldLMfagkIwul/1KSonDSHguSPVW2feH0qd7s=
-----END CERTIFICATE-----`;

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST?.trim(),
      database: process.env.MYSQL_DATABASE?.trim(),
      user: process.env.MYSQL_USER?.trim(),
      password: process.env.MYSQL_PASSWORD?.trim(),
      waitForConnections: true,
      connectionLimit: 5,
      ssl: {
        ca: OCI_MYSQL_CA,
        rejectUnauthorized: true,
        // Cert has a generic CN (MySQL_Endpoint_Server), no SAN, and we connect by
        // IP — hostname verification can't pass. Skip the hostname check while
        // keeping full CA-chain verification (that's what stops MITM).
        checkServerIdentity: () => undefined,
      },
    });
  }
  return pool;
}
