const MINIO_PUBLIC_BASE_URL =
  process.env.MINIO_PUBLIC_BASE_URL || 'https://purveyor-undead-oops.ngrok-free.dev';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'social-ad-creatives';

export function minioObjectUrl(key: string): string {
  return `${MINIO_PUBLIC_BASE_URL.replace(/\/$/, '')}/${MINIO_BUCKET}/${key.replace(/^\/+/, '')}`;
}
