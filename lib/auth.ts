import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, eq, gte, lt, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, users } from '@/lib/db/schema'
import type { User } from '@/lib/db/schema'

export const SESSION_COOKIE = 'jarvis_session_token'
// Companion cookie: epoch-ms when the token is next due for rotation. Not a secret —
// forging it only changes *when* rotation happens, and lets the proxy skip the DB until then.
export const ROTATE_COOKIE  = 'jarvis_session_rot'
export const BCRYPT_ROUNDS = 12

export const SESSION_MAX_AGE_MS  = 30 * 24 * 60 * 60 * 1000 // 30 days (absolute)
export const SESSION_IDLE_MAX_MS = 3 * 24 * 60 * 60 * 1000  // 3 days without activity
export const ROTATE_EVERY_MS     = 6 * 60 * 60 * 1000       // token swapped after 6h of use
export const ROTATE_GRACE_MS     = 60 * 1000                // old token still accepted this long

export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'enabled'>

export const getSession = cache(async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const thirtyDaysAgo = new Date(Date.now() - SESSION_MAX_AGE_MS)
  const idleCutoff    = new Date(Date.now() - SESSION_IDLE_MAX_MS)
  const graceCutoff   = new Date(Date.now() - ROTATE_GRACE_MS)

  let rows: { sid: string; id: string; email: string; name: string; role: 'ADMIN' | 'USER'; enabled: boolean }[]
  try {
    rows = await db
      .select({
        sid:     sessions.id,
        id:      users.id,
        email:   users.email,
        name:    users.name,
        role:    users.role,
        enabled: users.enabled,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(
        or(
          eq(sessions.token, token),
          and(eq(sessions.prevToken, token), gte(sessions.rotatedAt, graceCutoff)),
        ),
        gte(sessions.createdAt, thirtyDaysAgo),
        gte(sessions.lastSeen, idleCutoff),
      ))
      .limit(1)
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause
    console.warn('[auth] getSession failed:', cause?.code ?? (err instanceof Error ? err.message : err))
    return null
  }

  const row = rows[0]
  if (!row) {
    // A rotated-out token shown again after the grace window is a replay: either a thief
    // or the real user on a stale copy. Kill the session so the stolen token can't be used
    // (and the new one, held by whoever rotated last, has to log in again).
    db.delete(sessions)
      .where(and(eq(sessions.prevToken, token), lt(sessions.rotatedAt, graceCutoff)))
      .catch(() => {})
    return null
  }
  if (!row.enabled) return null

  // Update lastSeen (non-blocking)
  db.update(sessions).set({ lastSeen: new Date() }).where(eq(sessions.id, row.sid)).catch(() => {})

  const { sid: _sid, ...user } = row
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
