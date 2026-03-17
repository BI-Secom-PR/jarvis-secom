import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, users } from '@/lib/db/schema'
import type { User } from '@/lib/db/schema'

export const SESSION_COOKIE = 'jarvis_session_token'

export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'enabled'>

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const rows = await db
    .select({
      id:      users.id,
      email:   users.email,
      name:    users.name,
      role:    users.role,
      enabled: users.enabled,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .limit(1)

  const user = rows[0]
  if (!user || !user.enabled) return null

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
