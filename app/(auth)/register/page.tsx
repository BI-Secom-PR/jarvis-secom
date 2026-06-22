import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import RegisterForm from './RegisterForm'
import HudBackground from '@/components/HudBackground'

export const metadata = { title: 'Solicitar acesso — Jarvis SECOM' }

export default async function RegisterPage() {
  const user = await getSession()
  if (user) redirect('/')

  return (
    <main className="hud-void-bg hud-scanlines h-dvh w-full flex items-center justify-center overflow-hidden relative px-4">
      <HudBackground variant="full" />
      <div className="relative z-10 w-full flex justify-center">
        <RegisterForm />
      </div>
    </main>
  )
}
