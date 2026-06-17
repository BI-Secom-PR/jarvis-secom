import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { passkeyCredentials } from '@/lib/db/schema'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const creds = await db
    .select({ credentialId: passkeyCredentials.credentialId, name: passkeyCredentials.name, createdAt: passkeyCredentials.createdAt })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.userId, session.id))

  return NextResponse.json(creds)
}
