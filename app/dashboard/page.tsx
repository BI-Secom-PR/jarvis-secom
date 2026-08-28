import { requireAuth } from '@/lib/auth'
import DashboardContainer from '@/components/DashboardContainer'

export const metadata = { title: 'Dashboard — Jarvis SECOM' }

export default async function DashboardPage() {
  const user = await requireAuth()
  return <DashboardContainer isAdmin={user.role === 'ADMIN'} />
}
