import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v3'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

const schema = z.object({
  email:    z.string().email(),
  name:     z.string().min(2).max(100),
  password: z.string().min(8).max(128),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  const { email, name, password } = parsed.data
  const normalizedEmail = email.toLowerCase()

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)

  if (existing.length > 0) {
    return NextResponse.json({ error: 'E-mail já cadastrado.' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await db.insert(users).values({
    email: normalizedEmail,
    name,
    passwordHash,
    role:    'USER',
    enabled: false,
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}
