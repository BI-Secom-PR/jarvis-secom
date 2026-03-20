import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v3'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { getSession, BCRYPT_ROUNDS } from '@/lib/auth'

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

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

  return NextResponse.json({ ok: true })
}
