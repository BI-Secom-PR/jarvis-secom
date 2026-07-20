import { NextResponse } from 'next/server'
import { asc } from 'drizzle-orm'
import { requireAdminApi } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

export async function GET() {
  const admin = await requireAdminApi()
  if (admin instanceof NextResponse) return admin

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
