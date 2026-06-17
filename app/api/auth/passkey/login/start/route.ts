import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, passkeyCredentials } from '@/lib/db/schema'
import { RP_ID, generateChallengeToken } from '@/lib/webauthn'
import { rateLimit, clientIp, tooManyRequests } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const limit = rateLimit(`passkey:login:start:${ip}`, 30, 60_000)
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec)

  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : null

  let allowCredentials: { id: string; transports: AuthenticatorTransport[] }[] = []

  if (email) {
    // Targeted mode: return only this user's credentials
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    const user = userRows[0]
    if (!user) {
      // Return empty options — browser will show no autofill suggestions (not an error)
      // For the button flow this would surface as "no passkey found"
      return NextResponse.json({ error: 'Nenhuma chave de acesso registrada para este e-mail.' }, { status: 404 })
    }

    const creds = await db
      .select({ credentialId: passkeyCredentials.credentialId, transports: passkeyCredentials.transports })
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, user.id))

    if (!creds.length) {
      return NextResponse.json({ error: 'Nenhuma chave de acesso registrada para este e-mail.' }, { status: 404 })
    }

    allowCredentials = creds.map(c => ({
      id:         c.credentialId,
      transports: (c.transports ?? []) as AuthenticatorTransport[],
    }))
  }
  // When no email: allowCredentials stays [] → discoverable credential / conditional UI mode

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification:  'preferred',
    allowCredentials,
  })

  const challengeToken = await generateChallengeToken(options.challenge)
  return NextResponse.json({ options, challengeToken })
}
