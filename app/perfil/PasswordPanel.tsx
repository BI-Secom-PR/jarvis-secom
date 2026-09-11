'use client'

import { useState, type FormEvent } from 'react'
import { postJson } from '@/lib/fetchUtils'

export default function PasswordPanel() {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (next !== confirm) {
      setError('As novas senhas não coincidem.')
      return
    }

    setLoading(true)
    const res  = await postJson('/api/auth/change-password', { currentPassword: current, newPassword: next })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'Erro ao alterar senha.')
      return
    }

    setCurrent('')
    setNext('')
    setConfirm('')
    setSuccess(true)
  }

  return (
    <section className="bg-surface backdrop-blur-[60px] border-[0.5px] border-separator rounded-[24px] p-6 mb-5">
      <h2 className="font-hud text-[13px] uppercase tracking-[0.16em] text-ink mb-1.5">Senha</h2>
      <p className="text-sm text-ink-3 mb-6 leading-relaxed">
        Troque a senha desta conta. Mínimo de 8 caracteres.
      </p>

      <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
        <input
          type="password"
          required
          autoComplete="current-password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          placeholder="Senha atual"
          className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={next}
          onChange={e => setNext(e.target.value)}
          placeholder="Nova senha (mín. 8 caracteres)"
          className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Confirmar nova senha"
          className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
        />

        {error   && <p className="text-danger text-sm">{error}</p>}
        {success && <p className="text-success text-sm">Senha alterada com sucesso.</p>}

        <button
          type="submit"
          disabled={loading}
          className="self-start bg-accent text-accent-ink rounded-xl px-5 py-3 text-sm font-medium hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? 'Salvando...' : 'Salvar senha'}
        </button>
      </form>
    </section>
  )
}
