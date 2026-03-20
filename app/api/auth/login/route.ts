import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v3'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, sessions } from '@/lib/db/schema'
import { SESSION_COOKIE } from '@/lib/auth'

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

const DUMMY_HASH = '$2b$12$invaliddummyhashforconstanttimingXXXXXXXXXXXXXXXXXXXXX'
const IS_PROD    = process.env.NODE_ENV === 'production'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  const { email, password } = parsed.data

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1)

  const user = rows[0]

  // Always run bcrypt to prevent timing attacks
  const valid = user
    ? await bcrypt.compare(password, user.passwordHash)
    : await bcrypt.compare(password, DUMMY_HASH).then(() => false)

  if (!valid) {
    return NextResponse.json({ error: 'E-mail ou senha inválidos.' }, { status: 401 })
  }

  // Credentials valid but user not yet enabled
  if (!user!.enabled) {
    return NextResponse.json({ redirect: '/waiting' })
  }

  // Create session
  const token = randomBytes(64).toString('hex')
  await db.insert(sessions).values({ token, userId: user!.id })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'strict',
    path:     '/',
    maxAge:   60 * 60 * 24 * 30, // 30 days
  })

  return res
}
