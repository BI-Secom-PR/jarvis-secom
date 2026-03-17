import { NextResponse } from 'next/server'
import { asc } from 'drizzle-orm'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

export async function GET() {
  await requireAdmin()

  const allUsers = await db
    .select({
      id:        users.id,
      email:     users.email,
      name:      users.name,
      role:      users.role,
      enabled:   users.enabled,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt))

  return NextResponse.json(allUsers)
}
