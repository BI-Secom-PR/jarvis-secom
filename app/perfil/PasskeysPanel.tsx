'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Passkey = {
  credentialId: string
  name:         string | null
  createdAt:    string
}

export default function PasskeysPanel({
  passkeys,
  allowed,
}: {
  passkeys: Passkey[]
  allowed:  boolean
}) {
  const router = useRouter()
  const [name, setName]     = useState('')
  const [busy, setBusy]     = useState<string | null>(null)
  const [error, setError]   = useState('')

  async function addPasskey() {
    setBusy('add')
    setError('')
    try {
      const startRes = await fetch('/api/auth/passkey/register/start', { method: 'POST' })
      const start = await startRes.json()
      if (!startRes.ok) throw new Error(start.error ?? 'Não foi possível iniciar o cadastro.')

      const { startRegistration } = await import('@simplewebauthn/browser')
      const credential = await startRegistration({ optionsJSON: start.options })

      const finishRes = await fetch('/api/auth/passkey/register/finish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ credential, challengeToken: start.challengeToken, name: name.trim() || undefined }),
      })
      if (!finishRes.ok) throw new Error((await finishRes.json()).error ?? 'Cadastro falhou.')

      setName('')
      router.refresh()
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setError('Operação cancelada.')
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao cadastrar a chave.')
      }
    } finally {
      setBusy(null)
    }
  }

  async function removePasskey(credentialId: string) {
    setBusy(credentialId)
    setError('')
    try {
      const res = await fetch(`/api/auth/passkey/${encodeURIComponent(credentialId)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Não foi possível remover.')
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao remover a chave.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="bg-surface backdrop-blur-[60px] border-[0.5px] border-separator rounded-[24px] p-6">
      <h2 className="font-hud text-[13px] uppercase tracking-[0.16em] text-ink mb-1.5">Chaves de acesso</h2>
      <p className="text-sm text-ink-3 mb-6 leading-relaxed">
        Entre com biometria ou PIN em vez da senha. Cada dispositivo guarda a sua própria chave —
        cadastre uma por aparelho que você usa.
      </p>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}

      {passkeys.length === 0 ? (
        <p className="text-sm text-ink-4 mb-6">Nenhuma chave cadastrada.</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-6">
          {passkeys.map(pk => (
            <li
              key={pk.credentialId}
              className="flex items-center justify-between gap-3 border-[0.5px] border-separator rounded-xl px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink truncate">{pk.name ?? 'Chave de acesso'}</p>
                <p className="text-xs text-ink-4">
                  Criada em {new Date(pk.createdAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <button
                onClick={() => removePasskey(pk.credentialId)}
                disabled={busy !== null}
                className="text-xs text-ink-4 hover:text-danger transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {busy === pk.credentialId ? 'Removendo...' : 'Remover'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {allowed ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nome do dispositivo (opcional)"
            maxLength={50}
            className="flex-1 bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
          />
          <button
            onClick={addPasskey}
            disabled={busy !== null}
            className="bg-accent text-accent-ink rounded-xl px-5 py-3 text-sm font-medium hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shrink-0"
          >
            {busy === 'add' ? 'Aguardando...' : 'Adicionar chave'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-4">
          Seu administrador ainda não liberou chaves de acesso para esta conta.
        </p>
      )}
    </section>
  )
}
