import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { fileExports } from '@/lib/db/schema'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth()
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const [row] = await db
    .select()
    .from(fileExports)
    .where(and(eq(fileExports.id, id), eq(fileExports.userId, user.id)))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Expired' }, { status: 404 })
  }

  const bytes = row.bytes as Buffer
  const body = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': row.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'Content-Length': String(row.sizeBytes),
      'Cache-Control': 'private, no-store',
    },
  })
}
