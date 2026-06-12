'use client'

import { useState } from 'react'

export default function LoginForm() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Erro desconhecido.')
      setLoading(false)
      return
    }

    // Full page navigation — ensures Safari includes the cookie
    const ALLOWED_REDIRECTS = ['/', '/waiting']
    if (data.redirect && ALLOWED_REDIRECTS.includes(data.redirect)) {
      window.location.href = data.redirect
      return
    }

    window.location.href = '/'
  }

  return (
    <div className="w-full max-w-sm bg-surface md:backdrop-blur-[60px] border-[0.5px] border-separator rounded-[28px] p-6 sm:p-8 shadow-(--shadow-modal)">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink tracking-[-0.3px]">Entrar</h1>
        <p className="text-sm text-ink-3 mt-1">Jarvis SECOM</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          placeholder="Senha"
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
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <p className="text-center text-xs text-ink-4 mt-6">
        Não tem conta?{' '}
        <a href="/register" className="text-accent-text hover:underline">
          Solicitar acesso
        </a>
      </p>
    </div>
  )
}
