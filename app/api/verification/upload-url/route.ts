import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createSignedUploadUrl, removeFiles, safeObjectPath } from '@/lib/storage';

/**
 * Mints a signed URL the browser PUTs verification files to directly, so the
 * bytes never pass through a Vercel function (4.5MB request body limit).
 * The service-role key stays server-side; the client only sees a URL scoped to
 * one object and valid for 2h.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = (await request.json()) as { name?: string };
  if (!name) return NextResponse.json({ error: 'Nome do arquivo não informado.' }, { status: 400 });

  const path = safeObjectPath(name);

  try {
    return NextResponse.json({ uploadUrl: await createSignedUploadUrl(path), path });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// Client-side cleanup of orphaned uploads (batch failed mid-way).
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { paths } = (await request.json()) as { paths?: string[] };
  if (paths?.length) await removeFiles(paths);
  return NextResponse.json({ ok: true });
}
