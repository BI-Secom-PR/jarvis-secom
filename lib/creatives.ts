import { createHash, createHmac } from 'node:crypto';

// Creative images live in an IDrive e2 bucket. e2's free tier cannot serve a
// public bucket (a raw object URL returns 403), so every read is a presigned
// SigV4 GET made server-side — see app/api/sentimentos/thumb/route.ts.
//
// Hand-rolled rather than pulling in @aws-sdk/client-s3 + s3-request-presigner:
// that is ~15 MB of serverless bundle to build one query string. Verified against
// the live bucket on 2026-08-26: bytes and md5 match the source files for jpg/png/
// webp, an expired signature returns 403, a tampered one 403, a missing key 404.
const ENDPOINT = process.env.E2_ENDPOINT || '';
const REGION = process.env.E2_REGION || 'us-east-1';
const ACCESS_KEY = process.env.E2_ACCESS_KEY || '';
const SECRET_KEY = process.env.E2_SECRET_KEY || '';
const BUCKET = process.env.E2_BUCKET || 'social-ad-creatives';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();

// AWS's encoder differs from encodeURIComponent on ! * ' ( ) — match it exactly
// or the canonical request won't reproduce the signature server-side.
const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function creativeObjectUrl(key: string, expiresIn = 3600): string {
  if (!ENDPOINT || !ACCESS_KEY || !SECRET_KEY) {
    throw new Error('E2_ENDPOINT / E2_ACCESS_KEY / E2_SECRET_KEY not configured');
  }
  const url = new URL(ENDPOINT);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${REGION}/s3/aws4_request`;

  // e2 is path-style: /bucket/key, each segment encoded, slashes preserved.
  const path = `/${BUCKET}/${key.replace(/^\/+/, '')}`.split('/').map(enc).join('/');

  const q = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${ACCESS_KEY}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  });
  q.sort();
  const canonicalQuery = [...q.entries()].map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');

  const canonicalRequest = [
    'GET', path, canonicalQuery, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  let k: Buffer = hmac(`AWS4${SECRET_KEY}`, date);
  for (const part of [REGION, 's3', 'aws4_request']) k = hmac(k, part);
  const signature = createHmac('sha256', k).update(toSign).digest('hex');

  return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
