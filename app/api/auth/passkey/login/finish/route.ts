import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { users, sessions, passkeyCredentials } from '@/lib/db/schema'
import { SESSION_COOKIE } from '@/lib/auth'
import { RP_ID, ORIGIN, verifyChallengeToken } from '@/lib/webauthn'
import { rateLimit, clientIp, tooManyRequests } from '@/lib/rateLimit'

const IS_PROD = process.env.NODE_ENV === 'production'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const limit = rateLimit(`passkey:login:finish:${ip}`, 30, 60_000)
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec)

  const body = await req.json().catch(() => null)
  if (!body?.credential || !body?.challengeToken) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  let challenge: string
  try {
    challenge = await verifyChallengeToken(body.challengeToken)
  } catch {
    return NextResponse.json({ error: 'Desafio expirado. Tente novamente.' }, { status: 400 })
  }

  const credRows = await db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.credentialId, body.credential.id))
    .limit(1)

  const cred = credRows[0]
  if (!cred) return NextResponse.json({ error: 'Chave de acesso não reconhecida.' }, { status: 401 })

  const userRows = await db.select().from(users).where(eq(users.id, cred.userId)).limit(1)
  const user = userRows[0]
  if (!user) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })
  if (!user.enabled) return NextResponse.json({ redirect: '/waiting' })

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response:          body.credential,
      expectedChallenge: challenge,
      expectedOrigin:    ORIGIN,
      expectedRPID:      RP_ID,
      credential: {
        id:         cred.credentialId,
        publicKey:  new Uint8Array(cred.publicKey),
        counter:    Number(cred.counter),
        transports: (cred.transports ?? []) as AuthenticatorTransport[],
      },
      requireUserVerification: false,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Verificação falhou.', detail: String(err) }, { status: 401 })
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'Chave de acesso inválida.' }, { status: 401 })
  }

  // Update counter
  await db
    .update(passkeyCredentials)
    .set({ counter: String(verification.authenticationInfo.newCounter) })
    .where(eq(passkeyCredentials.credentialId, cred.credentialId))

  // Create session (same pattern as password login)
  const token = randomBytes(64).toString('hex')
  await db.insert(sessions).values({ token, userId: user.id })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 60 * 24 * 30,
  })

  return res
}
