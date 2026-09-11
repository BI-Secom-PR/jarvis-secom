import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, passkeyCredentials } from '@/lib/db/schema'
import HudBackground from '@/components/HudBackground'
import ThemeToggle from '@/components/ThemeToggle'
import PasskeysPanel from './PasskeysPanel'
import PasswordPanel from './PasswordPanel'

export const metadata = { title: 'Perfil — Jarvis SECOM' }

export default async function PerfilPage() {
  const session = await requireAuth()

  const [row] = await db
    .select({ passkeyAllowed: users.passkeyAllowed })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1)

  const passkeys = await db
    .select({
      credentialId: passkeyCredentials.credentialId,
      name:         passkeyCredentials.name,
      createdAt:    passkeyCredentials.createdAt,
    })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.userId, session.id))

  return (
    <main className="hud-void-bg min-h-screen w-screen overflow-auto relative">
      <HudBackground variant="subtle" />
      <div className="relative z-10 max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-hud text-[22px] uppercase tracking-[0.18em] text-ink mb-1.5" style={{ textShadow: '0 0 14px color-mix(in srgb, var(--hud-cyan) 35%, transparent)' }}>Perfil</h1>
          <ThemeToggle />
        </div>
        <p className="font-hud text-[9px] uppercase tracking-[0.3em] text-ink-3 mb-8">{session.email}</p>

        <PasswordPanel />

        <PasskeysPanel
          passkeys={passkeys.map(p => ({ ...p, createdAt: p.createdAt.toISOString() }))}
          allowed={row?.passkeyAllowed ?? false}
        />

        <a href="/" className="inline-block mt-8 text-sm text-ink-2 hover:text-ink transition-colors">
          ← Voltar ao início
        </a>
      </div>
    </main>
  )
}
