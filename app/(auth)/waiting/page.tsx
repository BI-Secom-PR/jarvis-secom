import ThemeToggle from '@/components/ThemeToggle'

export const metadata = { title: 'Aguardando aprovação — Jarvis SECOM' }

export default function WaitingPage() {
  return (
    <main className="nebula-bg h-dvh w-full flex items-center justify-center overflow-hidden relative px-4">
      <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-20">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm bg-surface md:backdrop-blur-[60px] border-[0.5px] border-separator rounded-[28px] p-6 sm:p-8 text-center shadow-(--shadow-modal)">
        <div className="w-12 h-12 rounded-full bg-accent-soft border-[0.5px] border-accent-border flex items-center justify-center mx-auto mb-4 text-2xl">
          ⏳
        </div>
        <h1 className="text-lg font-semibold text-ink mb-2">Aguardando aprovação!</h1>
        <p className="text-sm text-ink-2 leading-relaxed">
          Assim que for aprovado você receberá um e-mail.
        </p>
        <a
          href="/login"
          className="mt-6 inline-block text-xs text-ink-4 hover:text-ink-2 transition-colors py-2"
        >
          Voltar ao login
        </a>
      </div>
    </main>
  )
}
