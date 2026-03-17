export const metadata = { title: 'Aguardando aprovação — Jarvis SECOM' }

export default function WaitingPage() {
  return (
    <main className="nebula-bg h-screen w-screen flex items-center justify-center overflow-hidden relative">
      <div className="w-full max-w-sm bg-[rgba(10,10,20,0.82)] backdrop-blur-[60px] border-[0.5px] border-white/[0.14] rounded-[28px] p-8 text-center shadow-[0_40px_100px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.1)]">
        <div className="w-12 h-12 rounded-full bg-[rgba(41,151,255,0.12)] border-[0.5px] border-[rgba(80,170,255,0.3)] flex items-center justify-center mx-auto mb-4 text-2xl">
          ⏳
        </div>
        <h1 className="text-lg font-semibold text-white mb-2">Aguardando aprovação!</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          Assim que for aprovado você receberá um e-mail.
        </p>
        <a
          href="/login"
          className="mt-6 inline-block text-xs text-white/30 hover:text-white/50 transition-colors"
        >
          Voltar ao login
        </a>
      </div>
    </main>
  )
}
