'use client'

import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'

export default function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div className="flex items-center gap-3">
      {user.role === 'ADMIN' && (
        <a
          href="/admin"
          className="text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          Usuários
        </a>
      )}
      <span className="text-xs text-white/40 max-w-[120px] truncate">{user.name}</span>
      <button
        onClick={handleLogout}
        className="text-xs text-white/25 hover:text-red-400/70 transition-colors cursor-pointer"
        title="Sair"
      >
        Sair
      </button>
    </div>
  )
}
