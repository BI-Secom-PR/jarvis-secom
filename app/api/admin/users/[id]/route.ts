import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v3'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, sessions } from '@/lib/db/schema'
import { sendApprovalEmail } from '@/lib/email'

const schema = z.object({
  enabled: z.boolean().optional(),
  name:    z.string().min(2).max(100).optional(),
  email:   z.string().email().optional(),
  role:    z.enum(['ADMIN', 'USER']).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin()
  const { id } = await params

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  // Admin cannot modify themselves (to prevent self-lockout)
  if (id === admin.id) {
    return NextResponse.json({ error: 'Você não pode alterar sua própria conta.' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  const { enabled, name, email, role } = parsed.data
  const enabledChanged = enabled !== undefined

  // Check email uniqueness if changing email
  if (email) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1)
    if (existing.length && existing[0].id !== id) {
      return NextResponse.json({ error: 'E-mail já está em uso.' }, { status: 409 })
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (enabledChanged)        patch.enabled = enabled
  if (name !== undefined) patch.name   = name
  if (email !== undefined) patch.email = email.toLowerCase()
  if (role !== undefined)  patch.role  = role

  const updated = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, id))
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role, enabled: users.enabled })

  if (!updated.length) {
    return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 })
  }

  // Disabling: kill all active sessions immediately
  if (enabledChanged && !enabled) {
    await db.delete(sessions).where(eq(sessions.userId, id))
  }

  // Enabling: send approval email (non-blocking)
  if (enabledChanged && enabled) {
    sendApprovalEmail(updated[0].email, updated[0].name).catch(console.error)
  }

  return NextResponse.json(updated[0])
}
