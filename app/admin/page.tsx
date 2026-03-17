import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'
import UsersTable from './UsersTable'

export const metadata = { title: 'Usuários — Jarvis SECOM' }

export default async function AdminPage() {
  const admin = await requireAdmin()

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

  return (
    <main className="nebula-bg min-h-screen w-screen overflow-auto relative">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold text-white tracking-[-0.3px] mb-1">Usuários</h1>
        <p className="text-sm text-white/30 mb-8">Gerencie o acesso ao Jarvis SECOM</p>
        <UsersTable initialUsers={allUsers} currentUserId={admin.id} />
      </div>
    </main>
  )
}
