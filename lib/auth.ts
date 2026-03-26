import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, users } from '@/lib/db/schema'
import type { User } from '@/lib/db/schema'

export const SESSION_COOKIE = 'jarvis_session_token'
export const BCRYPT_ROUNDS = 12

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'enabled'>

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const thirtyDaysAgo = new Date(Date.now() - SESSION_MAX_AGE_MS)

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
      .where(and(eq(sessions.token, token), gte(sessions.createdAt, thirtyDaysAgo)))
      .limit(1)
  } catch (err) {
    console.error('[auth] getSession query failed:', err)
    return null
  }

  const user = rows[0]
  if (!user || !user.enabled) return null

  // Update lastSeen (non-blocking)
  db.update(sessions).set({ lastSeen: new Date() }).where(eq(sessions.token, token)).catch(() => {})

  return user
}

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
