import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth'

// Paths that don't require authentication
const PUBLIC_PATHS = ['/login', '/register', '/waiting']

const IS_DEV = process.env.NODE_ENV === 'development'

// Nonce-based CSP. The header must also be set on the *request* so Next.js
// picks up the nonce for its own inline scripts (this forces dynamic
// rendering, which is fine — every page here is auth/cookie-dependent).
// Dev keeps unsafe-inline/unsafe-eval because HMR requires them.
function buildCsp(nonce: string): string {
  const scriptSrc = IS_DEV
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.public.blob.vercel-storage.com",
    "connect-src 'self' https://vercel.com https://*.public.blob.vercel-storage.com https://*.blob.vercel-storage.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

function withCsp(req: NextRequest): NextResponse {
  // API responses are JSON — nonce/CSP only matters for HTML documents
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('Content-Security-Policy', csp)
  return res
}

// Constant-time-ish comparison for the edge runtime (no node:crypto here):
// hashing both sides first means the byte-compare timing leaks nothing useful.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const va = new Uint8Array(ha)
  const vb = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Python engine: called server-to-server by /api/verification/run, never by
  // browsers. With INTERNAL_API_KEY set, only the shared secret gets through;
  // without it, fall through to the session-cookie check below (the caller
  // forwards the user's cookie).
  if (pathname.startsWith('/api/py/')) {
    const secret = process.env.INTERNAL_API_KEY
    if (secret) {
      const key = req.headers.get('x-internal-key')
      if (key && (await safeEqual(key, secret))) return NextResponse.next()
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Allow public pages, static assets, and auth API routes
  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/external/') || // Bearer-key auth inside the route
    pathname.startsWith('/api/verification/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/icon' ||
    pathname === '/apple-icon' ||
    pathname === '/manifest.webmanifest' ||
    pathname.match(/\.(png|jpg|jpeg|svg|ico|webmanifest)$/)
  ) {
    return withCsp(req)
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value

  if (!token) {
    // APIs must fail in-band: a redirect makes fetch() swallow the 401 and
    // hand the client login-page HTML, which then fails JSON parsing.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Token present — full DB validation happens in requireAuth() inside each route/page
  return withCsp(req)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
