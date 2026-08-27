import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { creativeObjectUrl } from '@/lib/creatives';

export const dynamic = 'force-dynamic';

// Object keys are DB-controlled paths like "meta/12345.jpg", or "meta/12345-2.jpg" for a
// carousel card — reject traversal defensively.
const SAFE_KEY = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

// Creatives sit in an IDrive e2 bucket that cannot be public on the free tier,
// so the browser can never fetch them directly. We presign a short-lived GET
// server-side and stream the bytes back same-origin — which also keeps the
// bucket credentials off the client and leaves the CSP at img-src 'self'.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = req.nextUrl.searchParams.get('key');
  if (!key || key.includes('..') || !SAFE_KEY.test(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(creativeObjectUrl(key, 300));
  } catch (e) {
    // A missing E2_* env would otherwise surface as a generic 502 and cost an
    // afternoon of debugging — say which it is.
    const msg = e instanceof Error && e.message.startsWith('E2_') ? e.message : 'Upstream unreachable';
    return NextResponse.json({ error: msg }, { status: 502 });
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
