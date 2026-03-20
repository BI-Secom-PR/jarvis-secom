'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginForm() {
  const router = useRouter()
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

    const ALLOWED_REDIRECTS = ['/', '/waiting']
    if (data.redirect && ALLOWED_REDIRECTS.includes(data.redirect)) {
      router.push(data.redirect)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="w-full max-w-sm bg-[rgba(10,10,20,0.82)] backdrop-blur-[60px] border-[0.5px] border-white/[0.14] rounded-[28px] p-8 shadow-[0_40px_100px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.1)]">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white tracking-[-0.3px]">Entrar</h1>
        <p className="text-sm text-white/40 mt-1">Jarvis SECOM</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="seu@email.com"
          className="bg-black/30 border-[0.5px] border-white/[0.12] rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors"
        />
        <input
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Senha"
          className="bg-black/30 border-[0.5px] border-white/[0.12] rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors"
        />

        {error && (
          <p className="text-red-400/80 text-xs px-1">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[rgba(41,151,255,0.22)] border-[0.5px] border-[rgba(80,170,255,0.35)] rounded-xl py-3 text-sm text-white font-medium hover:bg-[rgba(41,151,255,0.36)] transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <p className="text-center text-xs text-white/30 mt-6">
        Não tem conta?{' '}
        <a href="/register" className="text-[rgba(120,180,255,0.8)] hover:underline">
          Solicitar acesso
        </a>
      </p>
    </div>
  )
}
