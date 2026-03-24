import { requireAuth } from '@/lib/auth'
import VerificationContainer from '@/components/VerificationContainer'

export const metadata = { title: 'Verificação — Jarvis SECOM' }

export default async function VerificationPage() {
  await requireAuth()
  return <VerificationContainer />
}
