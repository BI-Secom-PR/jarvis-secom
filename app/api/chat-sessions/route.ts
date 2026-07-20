import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { requireAuthApi } from '@/lib/auth'
import { db } from '@/lib/db'
import { chatSessions } from '@/lib/db/schema'

export async function GET() {
  const user = await requireAuthApi()
  if (user instanceof NextResponse) return user

  const list = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.userId, user.id))
    .orderBy(desc(chatSessions.updatedAt))

  return NextResponse.json(list)
}

export async function POST(req: NextRequest) {
  const user = await requireAuthApi()
  if (user instanceof NextResponse) return user
  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title : 'Nova conversa'

  const [session] = await db
    .insert(chatSessions)
    .values({ userId: user.id, title })
    .returning()

  return NextResponse.json(session, { status: 201 })
}
