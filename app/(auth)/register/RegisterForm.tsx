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
      <div className="w-full max-w-sm bg-[rgba(10,10,20,0.82)] backdrop-blur-[60px] border-[0.5px] border-white/[0.14] rounded-[28px] p-8 text-center shadow-[0_40px_100px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.1)]">
        <div className="w-12 h-12 rounded-full bg-[rgba(41,151,255,0.12)] border-[0.5px] border-[rgba(80,170,255,0.3)] flex items-center justify-center mx-auto mb-4 text-2xl">
          ⏳
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Aguardando aprovação!</h2>
        <p className="text-sm text-white/50 leading-relaxed">
          Assim que for aprovado você receberá um e-mail.
        </p>
        <a href="/login" className="mt-6 inline-block text-xs text-white/30 hover:text-white/50 transition-colors">
          Voltar ao login
        </a>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm bg-[rgba(10,10,20,0.82)] backdrop-blur-[60px] border-[0.5px] border-white/[0.14] rounded-[28px] p-8 shadow-[0_40px_100px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.1)]">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white tracking-[-0.3px]">Solicitar acesso</h1>
        <p className="text-sm text-white/40 mt-1">Jarvis SECOM</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="text"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Seu nome"
          minLength={2}
          className="bg-black/30 border-[0.5px] border-white/[0.12] rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors"
        />
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
          placeholder="Senha (mín. 8 caracteres)"
          minLength={8}
          className="bg-black/30 border-[0.5px] border-white/[0.12] rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors"
        />
        <input
          type="password"
          required
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Confirmar senha"
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
          {loading ? 'Enviando...' : 'Solicitar acesso'}
        </button>
      </form>

      <p className="text-center text-xs text-white/30 mt-6">
        Já tem conta?{' '}
        <a href="/login" className="text-[rgba(120,180,255,0.8)] hover:underline">
          Entrar
        </a>
      </p>
    </div>
  )
}
