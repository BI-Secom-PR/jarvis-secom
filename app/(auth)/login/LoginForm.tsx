'use client'

import { useState, useEffect, useRef } from 'react'

export default function LoginForm() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // Post-login passkey enrollment prompt
  const [showEnrollPrompt, setShowEnrollPrompt] = useState(false)
  const [enrolling, setEnrolling]               = useState(false)
  const [enrollError, setEnrollError]           = useState('')

  // Ref to abort the conditional UI request when the user submits the form
  const abortCtrlRef = useRef<AbortController | null>(null)

  // ── Conditional UI (Apple-style passkey autofill) ────────────────────────
  // Starts silently on mount. When the user focuses the email field, their
  // stored passkeys appear as autofill suggestions — no button needed.
  useEffect(() => {
    let challengeToken: string | null = null
    let cancelled = false

    async function initConditionalPasskey() {
      try {
        const { browserSupportsWebAuthnAutofill, startAuthentication } = await import('@simplewebauthn/browser')
        if (!(await browserSupportsWebAuthnAutofill())) return

        // Get a discoverable-credential challenge (no email → allowCredentials: [])
        const startRes = await fetch('/api/auth/passkey/login/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!startRes.ok || cancelled) return
        const { options, challengeToken: token } = await startRes.json()
        challengeToken = token

        // Create abort controller so password-form submit can cancel this
        const ctrl = new AbortController()
        abortCtrlRef.current = ctrl

        // This promise stays pending until the user picks a passkey from autofill
        const credential = await startAuthentication({
          optionsJSON:       options,
          useBrowserAutofill: true,
        })

        if (cancelled) return

        const finishRes = await fetch('/api/auth/passkey/login/finish', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ credential, challengeToken }),
        })
        const data = await finishRes.json()
        if (!finishRes.ok) {
          setError(data.error ?? 'Autenticação com passkey falhou.')
          return
        }

        const ALLOWED = ['/', '/waiting']
        window.location.href = (data.redirect && ALLOWED.includes(data.redirect)) ? data.redirect : '/'
      } catch (err: unknown) {
        // NotAllowedError = user cancelled or abort — silent
        if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          console.error('[passkey conditional]', err)
        }
      }
    }

    initConditionalPasskey()

    return () => {
      cancelled = true
      abortCtrlRef.current?.abort()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Abort any pending conditional UI request before doing password login
    abortCtrlRef.current?.abort()

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
      window.location.href = data.redirect
      return
    }

    if (data.enrollPasskey) {
      setLoading(false)
      setShowEnrollPrompt(true)
      return
    }

    window.location.href = '/'
  }

  async function handleEnrollPasskey() {
    setEnrolling(true)
    setEnrollError('')
    try {
      const startRes = await fetch('/api/auth/passkey/register/start', { method: 'POST' })
      if (!startRes.ok) throw new Error((await startRes.json()).error)
      const { options, challengeToken } = await startRes.json()

      const { startRegistration } = await import('@simplewebauthn/browser')
      const credential = await startRegistration({ optionsJSON: options })

      const finishRes = await fetch('/api/auth/passkey/register/finish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ credential, challengeToken, name: 'Meu dispositivo' }),
      })
      if (!finishRes.ok) throw new Error((await finishRes.json()).error)

      window.location.href = '/'
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setEnrollError('Operação cancelada.')
      } else {
        setEnrollError(err instanceof Error ? err.message : 'Erro ao configurar passkey.')
      }
      setEnrolling(false)
    }
  }

  // ── Enrollment prompt ────────────────────────────────────────────────────
  if (showEnrollPrompt) {
    return (
      <div className="w-full max-w-sm bg-surface md:backdrop-blur-[60px] border-[0.5px] border-separator rounded-[28px] p-6 sm:p-8 shadow-(--shadow-modal)">
        <div className="mb-5">
          <div className="text-2xl mb-3">🔑</div>
          <h1 className="text-xl font-semibold text-ink tracking-[-0.3px]">Chave de acesso</h1>
          <p className="text-sm text-ink-3 mt-1 leading-relaxed">
            Seu administrador habilitou a criação de uma chave de acesso para sua conta. Use biometria ou PIN para entrar mais rapidamente da próxima vez.
          </p>
        </div>

        {enrollError && (
          <p className="text-danger text-xs px-1 mb-4">{enrollError}</p>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={handleEnrollPasskey}
            disabled={enrolling}
            className="w-full bg-accent text-accent-ink rounded-xl py-3 text-sm font-medium hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {enrolling ? 'Configurando...' : 'Configurar agora'}
          </button>
          <button
            onClick={() => { window.location.href = '/' }}
            disabled={enrolling}
            className="w-full border-[0.5px] border-separator rounded-xl py-3 text-sm text-ink-3 hover:text-ink hover:border-separator-strong transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            Agora não
          </button>
        </div>
      </div>
    )
  }

  // ── Login form ───────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-sm bg-surface md:backdrop-blur-[60px] border-[0.5px] border-separator rounded-[28px] p-6 sm:p-8 shadow-(--shadow-modal)">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink tracking-[-0.3px]">Entrar</h1>
        <p className="text-sm text-ink-3 mt-1">Jarvis SECOM</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* autocomplete="username webauthn" makes passkeys appear as autofill suggestions */}
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="seu@email.com"
          autoComplete="username webauthn"
          className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
        />
        <input
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Senha"
          autoComplete="current-password"
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
