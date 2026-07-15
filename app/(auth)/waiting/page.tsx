import HudBackground from '@/components/HudBackground'

export const metadata = { title: 'Aguardando aprovação — Jarvis SECOM' }

export default function WaitingPage() {
  return (
    <main className="hud-void-bg hud-scanlines h-dvh w-full flex items-center justify-center overflow-hidden relative px-4">
      <HudBackground variant="full" />
      <div className="relative z-10 w-full max-w-sm hud-panel rounded-[20px] p-7 sm:p-9 text-center">
        <div className="w-12 h-12 rounded-full bg-accent-soft border-[0.5px] border-accent-border flex items-center justify-center mx-auto mb-4 text-2xl">
          ⏳
        </div>
        <h1 className="font-hud text-[15px] uppercase tracking-[0.18em] text-ink mb-2.5" style={{ textShadow: '0 0 12px color-mix(in srgb, var(--hud-cyan) 35%, transparent)' }}>
          Aguardando aprovação
        </h1>
        <p className="text-sm text-ink-2 leading-relaxed">
          Assim que for aprovado você receberá um e-mail.
        </p>
        <a
          href="/login"
          className="mt-6 inline-block font-hud text-[10px] uppercase tracking-[0.22em] text-ink-4 hover:text-ink-2 transition-colors py-2"
        >
          Voltar ao login
        </a>
      </div>
    </main>
  )
}
