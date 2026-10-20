'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { postJson } from '@/lib/fetchUtils'

type Row = {
  id:       string
  device:   string
  ip:       string | null
  lastSeen: string
  current:  boolean
}

export default function SessionsPanel({ sessions }: { sessions: Row[] }) {
  const router = useRouter()
  const [busy, setBusy]   = useState<string | null>(null)
  const [error, setError] = useState('')

  async function revoke(body: { id: string } | { others: true }, key: string) {
    setBusy(key)
    setError('')
    try {
      const res = await postJson('/api/auth/sessions', body)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Não foi possível encerrar.')
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao encerrar a sessão.')
    } finally {
      setBusy(null)
    }
  }

  const hasOthers = sessions.some(s => !s.current)

  return (
    <section className="bg-surface backdrop-blur-[60px] border-[0.5px] border-separator rounded-[24px] p-6 mt-6">
      <h2 className="font-hud text-[13px] uppercase tracking-[0.16em] text-ink mb-1.5">Sessões ativas</h2>
      <p className="text-sm text-ink-3 mb-6 leading-relaxed">
        Dispositivos com acesso à sua conta agora. Não reconhece algum? Encerre a sessão e troque a senha.
      </p>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}

      <ul className="flex flex-col gap-2">
        {sessions.map(s => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 border-[0.5px] border-separator rounded-xl px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm text-ink truncate">
                {s.device}{s.current && <span className="ml-2 text-xs text-accent">esta sessão</span>}
              </p>
              <p className="text-xs text-ink-4">
                {s.ip ?? 'IP desconhecido'} · último uso {new Date(s.lastSeen).toLocaleString('pt-BR')}
              </p>
            </div>
            {!s.current && (
              <button
                onClick={() => revoke({ id: s.id }, s.id)}
                disabled={busy !== null}
                className="text-xs text-ink-4 hover:text-danger transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {busy === s.id ? 'Encerrando...' : 'Encerrar'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {hasOthers && (
        <button
          onClick={() => revoke({ others: true }, 'others')}
          disabled={busy !== null}
          className="mt-4 text-sm text-ink-3 hover:text-danger transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === 'others' ? 'Encerrando...' : 'Encerrar todas as outras'}
        </button>
      )}
    </section>
  )
}
