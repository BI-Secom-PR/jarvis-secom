import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth'

// Paths that don't require authentication
const PUBLIC_PATHS = ['/login', '/register', '/waiting']

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public pages, static assets, and auth API routes
  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.match(/\.(png|jpg|jpeg|svg|ico|webmanifest)$/)
  ) {
    return NextResponse.next()
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value

  if (!token) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Token present — full DB validation happens in requireAuth() inside each route/page
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
