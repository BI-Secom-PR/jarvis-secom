import { requireAuth } from '@/lib/auth'
import Link from 'next/link'

export const metadata = { title: 'Verificação — Jarvis SECOM' }

export default async function VerificationPage() {
  await requireAuth()
  return (
    <main className="h-screen w-screen flex items-center justify-center overflow-hidden relative nebula-bg">
      <div className="relative z-10 flex flex-col items-center gap-4 text-center px-6">
        <p className="text-white/50 text-sm">Em construção</p>
        <Link href="/" className="text-xs text-[rgba(120,180,255,0.7)] hover:text-[rgba(120,180,255,0.95)] transition-colors">
          ← Voltar ao início
        </Link>
      </div>
    </main>
  )
}
