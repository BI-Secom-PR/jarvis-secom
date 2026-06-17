import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, passkeyCredentials } from '@/lib/db/schema'
import { RP_ID, ORIGIN, verifyChallengeToken } from '@/lib/webauthn'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const userRows = await db.select().from(users).where(eq(users.id, session.id)).limit(1)
  if (!userRows[0]?.passkeyAllowed) {
    return NextResponse.json({ error: 'Sem permissão para criar passkey.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.credential || !body?.challengeToken) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  let challenge: string
  try {
    challenge = await verifyChallengeToken(body.challengeToken)
  } catch {
    return NextResponse.json({ error: 'Desafio expirado ou inválido.' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response:           body.credential,
      expectedChallenge:  challenge,
      expectedOrigin:     ORIGIN,
      expectedRPID:       RP_ID,
      requireUserVerification: false,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Verificação falhou.', detail: String(err) }, { status: 400 })
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'Verificação falhou.' }, { status: 400 })
  }

  const { credential } = verification.registrationInfo
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : 'Chave de acesso'

  await db.insert(passkeyCredentials).values({
    credentialId: credential.id,
    userId:       session.id,
    publicKey:    Buffer.from(credential.publicKey),
    counter:      String(credential.counter),
    transports:   (body.credential.response?.transports ?? []) as string[],
    name,
  })

  return NextResponse.json({ ok: true })
}
