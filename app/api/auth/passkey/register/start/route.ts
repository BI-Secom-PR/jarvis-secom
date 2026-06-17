import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, passkeyCredentials } from '@/lib/db/schema'
import { RP_ID, RP_NAME, generateChallengeToken } from '@/lib/webauthn'

export async function POST(_req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const userRows = await db.select().from(users).where(eq(users.id, session.id)).limit(1)
  const user = userRows[0]
  if (!user?.passkeyAllowed) {
    return NextResponse.json({ error: 'Sem permissão para criar passkey.' }, { status: 403 })
  }

  const existing = await db
    .select({ credentialId: passkeyCredentials.credentialId, transports: passkeyCredentials.transports })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.userId, session.id))

  const userIdBytes = Uint8Array.from(Buffer.from(session.id.replace(/-/g, ''), 'hex'))

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID:   RP_ID,
    userName:        session.email,
    userDisplayName: session.name,
    userID:          userIdBytes,
    excludeCredentials: existing.map(c => ({
      id:         c.credentialId,
      transports: (c.transports ?? []) as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      userVerification: 'preferred',
      residentKey:      'preferred',
    },
  })

  const challengeToken = await generateChallengeToken(options.challenge)
  return NextResponse.json({ options, challengeToken })
}
