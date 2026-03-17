import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import RegisterForm from './RegisterForm'

export const metadata = { title: 'Solicitar acesso — Jarvis SECOM' }

export default async function RegisterPage() {
  const user = await getSession()
  if (user) redirect('/')

  return (
    <main className="nebula-bg h-screen w-screen flex items-center justify-center overflow-hidden relative">
      <RegisterForm />
    </main>
  )
}
