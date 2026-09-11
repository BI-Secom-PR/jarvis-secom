'use client'

import { useState, useEffect, useRef } from 'react'

export default function LoginForm() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // Explicit "entrar com chave de acesso" button (conditional UI is silent and
  // never shows when the browser has no autofill support)
  const [pkSupported, setPkSupported] = useState(false)
  const [pkLoading, setPkLoading]     = useState(false)

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
        const { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication } = await import('@simplewebauthn/browser')
        if (browserSupportsWebAuthn()) setPkSupported(true)
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

        await finishPasskeyLogin(credential, challengeToken)
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

  // Shared tail of both passkey paths (autofill and the explicit button)
  async function finishPasskeyLogin(credential: unknown, challengeToken: string | null) {
    const res  = await fetch('/api/auth/passkey/login/finish', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ credential, challengeToken }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Autenticação com passkey falhou.')
      return
    }

    const ALLOWED = ['/', '/waiting']
    window.location.href = (data.redirect && ALLOWED.includes(data.redirect)) ? data.redirect : '/'
  }

  // Explicit button: modal passkey prompt. With an e-mail typed the server
  // narrows to that user's credentials; empty falls back to discoverable ones.
  async function handlePasskeyLogin() {
    setPkLoading(true)
    setError('')
    try {
      const startRes = await fetch('/api/auth/passkey/login/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(email ? { email } : {}),
      })
      const start = await startRes.json()
      if (!startRes.ok) throw new Error(start.error ?? 'Não foi possível iniciar a chave de acesso.')

      // startAuthentication aborts the pending conditional-UI ceremony itself
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const credential = await startAuthentication({ optionsJSON: start.options })

      await finishPasskeyLogin(credential, start.challengeToken)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setError('Operação cancelada.')
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao entrar com chave de acesso.')
      }
    } finally {
      setPkLoading(false)
    }
  }

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
      <div className="w-full max-w-sm hud-panel rounded-[20px] p-7 sm:p-9 relative">
        <div className="mb-5">
          <div className="text-2xl mb-3">🔑</div>
          <h1 className="font-hud text-[16px] uppercase tracking-[0.16em] text-ink" style={{ textShadow: '0 0 12px color-mix(in srgb, var(--hud-cyan) 35%, transparent)' }}>Chave de acesso</h1>
          <p className="text-sm text-ink-3 mt-2 leading-relaxed">
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
    <div className="w-full max-w-sm hud-panel rounded-[20px] p-7 sm:p-9 relative">
      <div className="mb-7">
        <h1 className="font-hud text-[20px] uppercase tracking-[0.2em] text-ink" style={{ textShadow: '0 0 14px color-mix(in srgb, var(--hud-cyan) 40%, transparent)' }}>Entrar</h1>
        <p className="font-hud text-[9px] uppercase tracking-[0.34em] text-accent-text mt-2">Jarvis SECOM</p>
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
          disabled={loading || pkLoading}
          className="w-full bg-accent text-accent-ink rounded-xl py-3 text-sm font-medium hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        {pkSupported && (
          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={loading || pkLoading}
            className="w-full flex items-center justify-center gap-2 border-[0.5px] border-separator rounded-xl py-3 text-sm text-ink-3 hover:text-ink hover:border-separator-strong transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="4" />
              <path d="M11 11l9 9m-3 0 3-3m-6-3 2.5 2.5M4 21c0-3.3 1.8-5 4-5" />
            </svg>
            {pkLoading ? 'Aguardando...' : 'Entrar com chave de acesso'}
          </button>
        )}
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
