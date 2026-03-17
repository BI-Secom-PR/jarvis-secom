import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod/v3'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { chatMessages, chatSessions } from '@/lib/db/schema'

const postSchema = z.object({
  role:      z.enum(['USER', 'AI']),
  content:   z.string().min(1),
  chartData: z.unknown().optional(),
})

async function verifyOwnership(sessionId: string, userId: string) {
  const [s] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .limit(1)
  return s ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth()
  const { id } = await params

  const session = await verifyOwnership(id, user.id)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatSessionId, id))
    .orderBy(asc(chatMessages.createdAt))

  return NextResponse.json(messages)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth()
  const { id } = await params

  const session = await verifyOwnership(id, user.id)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  const { role, content, chartData } = parsed.data

  const [msg] = await db
    .insert(chatMessages)
    .values({ chatSessionId: id, role, content, chartData: chartData ?? null })
    .returning()

  // Bump session updatedAt
  await db
    .update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.id, id))

  return NextResponse.json(msg, { status: 201 })
}
