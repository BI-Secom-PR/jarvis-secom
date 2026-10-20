import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v3'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, passkeyCredentials } from '@/lib/db/schema'
import { createSession, setSessionCookies } from '@/lib/sessions'
import { rateLimit, clientIp, tooManyRequests } from '@/lib/rateLimit'

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

const DUMMY_HASH = '$2b$12$invaliddummyhashforconstanttimingXXXXXXXXXXXXXXXXXXXXX'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const ipLimit = rateLimit(`login:ip:${ip}`, 20, 15 * 60_000)
  if (!ipLimit.ok) return tooManyRequests(ipLimit.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  const { email, password } = parsed.data

  const accountLimit = rateLimit(`login:acct:${ip}:${email.toLowerCase()}`, 5, 15 * 60_000)
  if (!accountLimit.ok) return tooManyRequests(accountLimit.retryAfterSec)

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
  const token = await createSession(req, user!)

  // Check if user should be prompted to enroll a passkey
  let enrollPasskey = false
  if (user!.passkeyAllowed) {
    const existingPasskeys = await db
      .select({ credentialId: passkeyCredentials.credentialId })
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, user!.id))
      .limit(1)
    enrollPasskey = existingPasskeys.length === 0
  }

  const res = NextResponse.json({ ok: true, ...(enrollPasskey && { enrollPasskey: true }) })
  setSessionCookies(res, token)

  return res
}
