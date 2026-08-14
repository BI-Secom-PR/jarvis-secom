/**
 * Supabase Storage staging for verification uploads.
 *
 * Replaces Vercel Blob. This is not durable storage — it is a staging area that
 * lets the browser upload files directly, bypassing Vercel's 4.5MB body limit.
 * Files are deleted as soon as the engine has read them.
 *
 * Talks to the Storage REST API with plain fetch: four endpoints don't justify
 * pulling in supabase-js. Endpoints verified against storage-js upstream
 * (StorageFileApi.ts) rather than from memory.
 *
 * The service-role key must never reach the browser — it lives only in these
 * server-side helpers, and the client only ever sees short-lived signed URLs.
 */
const BUCKET = 'verification-uploads';

function storageUrl(): string {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new Error('SUPABASE_URL is not set');
  return `${base.replace(/\/$/, '')}/storage/v1`;
}

function authHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return { Authorization: `Bearer ${key}`, apikey: key };
}

/**
 * Build an object key for a user-supplied filename.
 *
 * Storage rejects non-ASCII keys outright (`InvalidKey`), and real comprovantes
 * are full of them — "ALÔ ALÔ BAHIA.xlsx". Accents are stripped here rather than
 * transliterated because the key is throwaway: the *original* filename travels
 * separately to engine.py, which is what actually keys off it.
 * The UUID prefix keeps concurrent runs from colliding.
 */
export function safeObjectPath(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos: ô → o
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '');
  return `${crypto.randomUUID()}/${ascii || 'arquivo.xlsx'}`;
}

/**
 * Mint a signed upload URL the browser can PUT bytes to directly.
 * Valid for 2h (upstream default). The URL carries a one-file token — handing
 * it to the client leaks no service-role credential.
 */
export async function createSignedUploadUrl(path: string): Promise<string> {
  const resp = await fetch(`${storageUrl()}/object/upload/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!resp.ok) throw new Error(`signed upload URL failed (HTTP ${resp.status}): ${await resp.text()}`);
  const { url } = (await resp.json()) as { url: string };
  return `${storageUrl()}${url}`;
}

/**
 * Mint a signed download URL. Needs no auth header to fetch, which is why
 * api/py/verification.py's `_download_url` works against it unchanged.
 */
export async function createSignedDownloadUrl(path: string, expiresIn = 600): Promise<string> {
  const resp = await fetch(`${storageUrl()}/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  if (!resp.ok) throw new Error(`signed download URL failed (HTTP ${resp.status}): ${await resp.text()}`);
  const { signedURL } = (await resp.json()) as { signedURL: string };
  return `${storageUrl()}${signedURL}`;
}

/** Best-effort cleanup — mirrors the old `del()` semantics, never throws. */
export async function removeFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await fetch(`${storageUrl()}/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => {});
}

/**
 * Create the private bucket if it doesn't exist yet (idempotent, setup-time).
 *
 * ponytail: 50MB/file is the Supabase free-tier ceiling, and comprovantes are
 * expected to exceed it eventually. Upgrade path when they do: paid plan raises
 * the global limit, and files past ~6MB should move to resumable/TUS uploads
 * (`/upload/resumable`) instead of the single PUT used here.
 */
export async function ensureBucket(fileSizeLimitBytes = 52_428_800): Promise<'created' | 'exists'> {
  const resp = await fetch(`${storageUrl()}/bucket`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: fileSizeLimitBytes }),
  });
  if (resp.ok) return 'created';
  const text = await resp.text();
  if (resp.status === 409 || text.includes('already exists')) return 'exists';
  throw new Error(`bucket creation failed (HTTP ${resp.status}): ${text}`);
}

export { BUCKET };
