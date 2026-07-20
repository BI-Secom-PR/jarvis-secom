import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v3'
import bcrypt from 'bcryptjs'
import { eq, and, ne } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { users, sessions } from '@/lib/db/schema'
import { getSession, BCRYPT_ROUNDS, SESSION_COOKIE } from '@/lib/auth'
import { rateLimit, clientIp, tooManyRequests } from '@/lib/rateLimit'

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8).max(128),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const ipLimit = rateLimit(`change-pw:ip:${clientIp(req)}`, 10, 15 * 60_000)
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfterSec)
  const userLimit = rateLimit(`change-pw:user:${session.id}`, 5, 15 * 60_000)
  if (!userLimit.ok) return tooManyRequests(userLimit.retryAfterSec)

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  const { currentPassword, newPassword } = parsed.data

  const rows = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1)

  const user = rows[0]
  if (!user) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 })

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 401 })
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, session.id))

  // Revoke every other session for this user — a stolen token elsewhere gets
  // kicked out immediately; the current browser keeps working.
  const currentToken = (await cookies()).get(SESSION_COOKIE)?.value
  if (currentToken) {
    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, session.id), ne(sessions.token, currentToken)))
  }

  return NextResponse.json({ ok: true })
}
