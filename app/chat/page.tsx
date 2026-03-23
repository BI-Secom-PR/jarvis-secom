import { requireAuth } from '@/lib/auth'
import ChatContainer from '@/components/ChatContainer'

export const metadata = { title: 'Chat — Jarvis SECOM' }

export default async function ChatPage() {
  const user = await requireAuth()
  return (
    <main className="h-screen w-screen flex items-center justify-center overflow-hidden relative nebula-bg">
      <ChatContainer user={user} />
    </main>
  )
}
