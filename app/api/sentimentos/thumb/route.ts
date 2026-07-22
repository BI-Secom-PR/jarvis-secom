import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { minioObjectUrl } from '@/lib/minio';

export const dynamic = 'force-dynamic';

// Object keys are DB-controlled paths like "meta/12345.jpg" — reject traversal defensively.
const SAFE_KEY = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

// The free ngrok tunnel in front of MinIO shows an HTML "visit site" interstitial
// to any request that looks like it came from a browser, so a plain <img src>
// pointed straight at it renders broken. ngrok-skip-browser-warning only works
// as a request header (no query-param equivalent), which <img> can't send — so
// we fetch server-side with the header and stream the bytes back same-origin.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = req.nextUrl.searchParams.get('key');
  if (!key || key.includes('..') || !SAFE_KEY.test(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(minioObjectUrl(key), {
      headers: { 'ngrok-skip-browser-warning': 'true' },
    });
  } catch {
    return NextResponse.json({ error: 'Upstream unreachable' }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Not found' }, { status: upstream.status === 404 ? 404 : 502 });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'private, max-age=604800, immutable',
    },
  });
}
