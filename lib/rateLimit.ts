import { NextRequest, NextResponse } from 'next/server'

// In-memory fixed-window limiter. Per-process state: enough for a single-instance
// deployment; swap for Redis if the app is ever scaled horizontally.
type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key)
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now()
  if (buckets.size >= MAX_BUCKETS) sweep(now)

  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  if (bucket.count < limit) {
    bucket.count++
    return { ok: true }
  }
  return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

export function tooManyRequests(retryAfterSec: number): NextResponse {
  const wait = retryAfterSec >= 120
    ? `${Math.ceil(retryAfterSec / 60)} minutos`
    : `${retryAfterSec} segundos`
  return NextResponse.json(
    { error: `Muitas tentativas. Tente novamente em ${wait}.` },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  )
}
