import { SignJWT, jwtVerify } from 'jose'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

function deriveRpId(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return hostname || 'localhost'
  } catch {
    return 'localhost'
  }
}

export const RP_ID   = process.env.NODE_ENV === 'development' ? 'localhost' : deriveRpId(BASE_URL)
export const RP_NAME = 'Jarvis SECOM'
export const ORIGIN  = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : BASE_URL

function getSecret(): Uint8Array {
  const s = process.env.WEBAUTHN_SECRET
  if (!s) throw new Error('WEBAUTHN_SECRET env var is not set')
  return new TextEncoder().encode(s)
}

// challenge is the base64url string returned by generateRegistrationOptions / generateAuthenticationOptions
export async function generateChallengeToken(challenge: string): Promise<string> {
  return new SignJWT({ ch: challenge })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .setIssuedAt()
    .sign(getSecret())
}

export async function verifyChallengeToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, getSecret())
  const ch = payload['ch']
  if (typeof ch !== 'string') throw new Error('Invalid challenge token')
  return ch
}
