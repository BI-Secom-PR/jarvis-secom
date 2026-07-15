import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'
import UsersTable from './UsersTable'
import HudBackground from '@/components/HudBackground'
import ThemeToggle from '@/components/ThemeToggle'

export const metadata = { title: 'Usuários — Jarvis SECOM' }

export default async function AdminPage() {
  const admin = await requireAdmin()

  const allUsers = await db
    .select({
      id:             users.id,
      email:          users.email,
      name:           users.name,
      role:           users.role,
      enabled:        users.enabled,
      passkeyAllowed: users.passkeyAllowed,
      createdAt:      users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt))

  return (
    <main className="hud-void-bg min-h-screen w-screen overflow-auto relative">
      <HudBackground variant="subtle" />
      <div className="relative z-10 max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-hud text-[22px] uppercase tracking-[0.18em] text-ink mb-1.5" style={{ textShadow: '0 0 14px color-mix(in srgb, var(--hud-cyan) 35%, transparent)' }}>Usuários</h1>
          <ThemeToggle />
        </div>
        <p className="font-hud text-[9px] uppercase tracking-[0.3em] text-ink-3 mb-8">Gerencie o acesso ao Jarvis SECOM</p>
        <UsersTable initialUsers={allUsers} currentUserId={admin.id} />
      </div>
    </main>
  )
}
