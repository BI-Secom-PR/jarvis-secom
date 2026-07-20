// Only Vercel Blob's own storage domain may be fetched with the Blob token —
// anything else is a potential SSRF vector (private IPs, internal hosts, arbitrary
// external URLs that would receive our BLOB_READ_WRITE_TOKEN as a Bearer header).
const BLOB_HOST_RE = /^[a-z0-9]+\.(public\.)?blob\.vercel-storage\.com$/i;

export function isAllowedBlobUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && BLOB_HOST_RE.test(parsed.hostname);
}
