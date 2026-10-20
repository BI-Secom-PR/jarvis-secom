import { createHash, randomBytes } from 'node:crypto'
import { after, type NextRequest, type NextResponse } from 'next/server'
import { and, eq, gte, isNull, ne, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, knownDevices } from '@/lib/db/schema'
import {
  SESSION_COOKIE, ROTATE_COOKIE, SESSION_MAX_AGE_MS, SESSION_IDLE_MAX_MS, ROTATE_EVERY_MS,
} from '@/lib/auth'
import { clientIp } from '@/lib/rateLimit'
import { sendNewDeviceEmail } from '@/lib/email'

const IS_PROD = process.env.NODE_ENV === 'production'

const cookieOpts = {
  httpOnly: true,
  secure:   IS_PROD,
  sameSite: 'lax' as const,
  path:     '/',
  maxAge:   SESSION_MAX_AGE_MS / 1000,
}

export function setSessionCookies(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, cookieOpts)
  res.cookies.set(ROTATE_COOKIE, String(Date.now() + ROTATE_EVERY_MS), cookieOpts)
}

/** "Chrome · macOS" — coarse on purpose, so a browser update doesn't look like a new device. */
export function uaLabel(ua: string | null | undefined): string {
  const s = ua ?? ''
  const browser =
    /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Navegador'
  const os =
    /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows'
    : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : 'dispositivo desconhecido'
  return `${browser} · ${os}`
}

/** Creates the session row and returns the token; the caller sets the cookies on its response. */
export async function createSession(
  req: NextRequest,
  user: { id: string; email: string; name: string },
): Promise<string> {
  const token = randomBytes(64).toString('hex')
  const ip    = clientIp(req)
  const ua    = req.headers.get('user-agent')?.slice(0, 512) ?? null

  await db.insert(sessions).values({ token, userId: user.id, ip, userAgent: ua })

  // after(): on Vercel an un-awaited promise can be frozen with the lambda
  after(() => alertIfNewDevice(user, uaLabel(ua), ip).catch(err => console.warn('[sessions] new-device alert failed:', err)))

  return token
}

async function alertIfNewDevice(user: { id: string; email: string; name: string }, label: string, ip: string) {
  const uaHash = createHash('sha256').update(label).digest('hex')
  const [hadAny] = await db.select({ h: knownDevices.uaHash }).from(knownDevices).where(eq(knownDevices.userId, user.id)).limit(1)
  const inserted = await db.insert(knownDevices).values({ userId: user.id, uaHash }).onConflictDoNothing().returning({ h: knownDevices.uaHash })
  // First device ever seen for this user (e.g. right after this feature shipped) → nothing to compare against
  if (inserted.length && hadAny) await sendNewDeviceEmail(user.email, user.name, label, ip)
}

/**
 * Swaps the token for a fresh one. The UPDATE is keyed on the old token, so when parallel
 * requests race only one wins (the rest get null and keep using the grace window).
 */
export async function rotateSession(oldToken: string): Promise<string | null> {
  const next = randomBytes(64).toString('hex')
  const rows = await db
    .update(sessions)
    .set({ token: next, prevToken: oldToken, rotatedAt: new Date() })
    .where(and(
      eq(sessions.token, oldToken),
      gte(sessions.createdAt, new Date(Date.now() - SESSION_MAX_AGE_MS)),
      gte(sessions.lastSeen,  new Date(Date.now() - SESSION_IDLE_MAX_MS)),
    ))
    .returning({ id: sessions.id })
  return rows.length ? next : null
}

/** Deletes every session of the user except the one holding `currentToken` (current or just-rotated). */
export async function revokeOtherSessions(userId: string, currentToken: string): Promise<void> {
  // prev_token is usually NULL, and NOT (… OR NULL) is NULL (row kept) — hence the explicit isNull branch
  await db.delete(sessions).where(and(
    eq(sessions.userId, userId),
    ne(sessions.token, currentToken),
    or(isNull(sessions.prevToken), ne(sessions.prevToken, currentToken)),
  ))
}
