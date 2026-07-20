import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isAllowedBlobUrl } from '@/lib/blobUrl';
import { rateLimit, tooManyRequests } from '@/lib/rateLimit';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      // Session check lives here (not at the top of the route): the
      // blob.upload-completed event is a server-to-server webhook from Vercel
      // with no session cookie — handleUpload authenticates it by signature.
      onBeforeGenerateToken: async (pathname) => {
        const session = await getSession();
        if (!session) throw new Error('Unauthorized');
        const safeName = pathname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
        return {
          pathname: safeName,
          access: 'private',
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

// Client-side cleanup of orphaned uploads (batch failed mid-way).
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit(`blob-delete:${session.id}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const { urls } = (await request.json()) as { urls?: string[] };
  if (!urls?.length) return NextResponse.json({ ok: true });

  if (!urls.every(isAllowedBlobUrl)) {
    return NextResponse.json({ error: 'URL(s) fora da allowlist de Blob.' }, { status: 400 });
  }

  await del(urls).catch(() => {});
  return NextResponse.json({ ok: true });
}
