import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { passkeyCredentials } from '@/lib/db/schema'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { id } = await params

  const deleted = await db
    .delete(passkeyCredentials)
    .where(and(
      eq(passkeyCredentials.credentialId, id),
      eq(passkeyCredentials.userId, session.id),
    ))
    .returning({ credentialId: passkeyCredentials.credentialId })

  if (!deleted.length) {
    return NextResponse.json({ error: 'Chave não encontrada.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
