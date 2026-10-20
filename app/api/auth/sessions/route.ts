import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod/v3'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions } from '@/lib/db/schema'
import { getSession, SESSION_COOKIE } from '@/lib/auth'
import { revokeOtherSessions } from '@/lib/sessions'

const schema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({ others: z.literal(true) }),
])

// Revoke one of the caller's own sessions by public id, or all but the current one.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })

  if ('id' in parsed.data) {
    await db.delete(sessions).where(and(eq(sessions.id, parsed.data.id), eq(sessions.userId, session.id)))
  } else {
    const token = (await cookies()).get(SESSION_COOKIE)?.value
    if (token) await revokeOtherSessions(session.id, token)
  }

  return NextResponse.json({ ok: true })
}
