'use client'

import { useState } from 'react'

export default function RegisterForm() {
  const [name, setName]             = useState('')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [done, setDone]             = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)

    const res  = await fetch('/api/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Erro ao criar conta.')
      setLoading(false)
      return
    }

    setDone(true)
  }

  if (done) {
    return (
      <div className="w-full max-w-sm bg-surface md:backdrop-blur-[60px] border-[0.5px] border-separator rounded-[28px] p-6 sm:p-8 text-center shadow-(--shadow-modal)">
        <div className="w-12 h-12 rounded-full bg-accent-soft border-[0.5px] border-accent-border flex items-center justify-center mx-auto mb-4 text-2xl">
          ⏳
        </div>
        <h2 className="text-lg font-semibold text-ink mb-2">Aguardando aprovação!</h2>
        <p className="text-sm text-ink-2 leading-relaxed">
          Assim que for aprovado você receberá um e-mail.
        </p>
        <a href="/login" className="mt-6 inline-block text-xs text-ink-4 hover:text-ink-2 transition-colors py-2">
          Voltar ao login
        </a>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm bg-surface md:backdrop-blur-[60px] border-[0.5px] border-separator rounded-[28px] p-6 sm:p-8 shadow-(--shadow-modal)">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink tracking-[-0.3px]">Solicitar acesso</h1>
        <p className="text-sm text-ink-3 mt-1">Jarvis SECOM</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="text"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Seu nome"
          minLength={2}
          className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
        />
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="seu@email.com"
          className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
        />
        <input
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Senha (mín. 8 caracteres)"
          minLength={8}
          className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
        />
        <input
          type="password"
          required
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Confirmar senha"
          className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
        />

        {error && (
          <p className="text-danger text-xs px-1">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent text-accent-ink rounded-xl py-3 text-sm font-medium hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? 'Enviando...' : 'Solicitar acesso'}
        </button>
      </form>

      <p className="text-center text-xs text-ink-4 mt-6">
        Já tem conta?{' '}
        <a href="/login" className="text-accent-text hover:underline">
          Entrar
        </a>
      </p>
    </div>
  )
}
