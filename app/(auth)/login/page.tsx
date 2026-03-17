import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import LoginForm from './LoginForm'

export const metadata = { title: 'Entrar — Jarvis SECOM' }

export default async function LoginPage() {
  const user = await getSession()
  if (user) redirect('/')

  return (
    <main className="nebula-bg h-screen w-screen flex items-center justify-center overflow-hidden relative">
      <LoginForm />
    </main>
  )
}
