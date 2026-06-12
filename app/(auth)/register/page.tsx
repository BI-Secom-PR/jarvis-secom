import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import RegisterForm from './RegisterForm'
import ThemeToggle from '@/components/ThemeToggle'

export const metadata = { title: 'Solicitar acesso — Jarvis SECOM' }

export default async function RegisterPage() {
  const user = await getSession()
  if (user) redirect('/')

  return (
    <main className="nebula-bg h-dvh w-full flex items-center justify-center overflow-hidden relative px-4">
      <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-20">
        <ThemeToggle />
      </div>
      <RegisterForm />
    </main>
  )
}
