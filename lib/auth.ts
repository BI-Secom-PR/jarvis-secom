import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, users } from '@/lib/db/schema'
import type { User } from '@/lib/db/schema'

export const SESSION_COOKIE = 'jarvis_session_token'
export const BCRYPT_ROUNDS = 12

// A handful of the most-guessed passwords — not a full deny-list (that's
// overkill for this app's threat model), just catches the laziest picks.
const COMMON_PASSWORDS = new Set([
  '12345678', 'password', 'password1', 'senha1234', 'senha123',
  '11111111', 'qwertyui', 'admin123', 'abc12345', 'letmein1',
])

export function weakPasswordReason(password: string, email?: string): string | null {
  if (email && password.toLowerCase() === email.toLowerCase()) {
    return 'A senha não pode ser igual ao e-mail.'
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Senha muito comum. Escolha outra.'
  }
  return null
}

const SESSION_MAX_AGE_MS  = 30 * 24 * 60 * 60 * 1000 // 30 days (absolute)
const SESSION_IDLE_MAX_MS = 3 * 24 * 60 * 60 * 1000  // 3 days without activity

export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'enabled'>

export const getSession = cache(async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const thirtyDaysAgo = new Date(Date.now() - SESSION_MAX_AGE_MS)
  const idleCutoff    = new Date(Date.now() - SESSION_IDLE_MAX_MS)

  let rows: { id: string; email: string; name: string; role: 'ADMIN' | 'USER'; enabled: boolean }[]
  try {
    rows = await db
      .select({
        id:      users.id,
        email:   users.email,
        name:    users.name,
        role:    users.role,
        enabled: users.enabled,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(
        eq(sessions.token, token),
        gte(sessions.createdAt, thirtyDaysAgo),
        gte(sessions.lastSeen, idleCutoff),
      ))
      .limit(1)
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause
    console.warn('[auth] getSession failed:', cause?.code ?? (err instanceof Error ? err.message : err))
    return null
  }

  const user = rows[0]
  if (!user || !user.enabled) return null

  // Update lastSeen (non-blocking)
  db.update(sessions).set({ lastSeen: new Date() }).where(eq(sessions.token, token)).catch(() => {})

  return user
})

export async function requireAuth(): Promise<SessionUser> {
  const user = await getSession()
  if (!user) redirect('/login')
  return user
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireAuth()
  if (user.role !== 'ADMIN') redirect('/')
  return user
}

// API-route variant: a redirect() response is HTML, which a fetch() caller
// can't parse as JSON. These return a 401/403 JSON NextResponse instead —
// check `instanceof NextResponse` and return it straight from the handler.
export async function requireAuthApi(): Promise<SessionUser | NextResponse> {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return user
}

export async function requireAdminApi(): Promise<SessionUser | NextResponse> {
  const user = await requireAuthApi()
  if (user instanceof NextResponse) return user
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return user
}
