import { requireAuth } from '@/lib/auth'
import SentimentosContainer from '@/components/SentimentosContainer'

export const metadata = { title: 'Sentimentos — Jarvis SECOM' }

export default async function SentimentosPage() {
  const user = await requireAuth()
  return <SentimentosContainer userEmail={user.email} />
}
