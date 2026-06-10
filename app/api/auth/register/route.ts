import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v3'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { BCRYPT_ROUNDS } from '@/lib/auth'
import { rateLimit, clientIp, tooManyRequests } from '@/lib/rateLimit'

const schema = z.object({
  email:    z.string().email(),
  name:     z.string().min(2).max(100),
  password: z.string().min(8).max(128),
})

export async function POST(req: NextRequest) {
  const limit = rateLimit(`register:${clientIp(req)}`, 5, 60 * 60_000)
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec)

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  const { email, name, password } = parsed.data
  const normalizedEmail = email.toLowerCase()

  // Hash unconditionally and respond identically whether the e-mail is new or
  // already registered — prevents account enumeration via response or timing.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  await db
    .insert(users)
    .values({
      email: normalizedEmail,
      name,
      passwordHash,
      role:    'USER',
      enabled: false,
    })
    .onConflictDoNothing({ target: users.email })

  return NextResponse.json({ ok: true }, { status: 201 })
}
