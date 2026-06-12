import { requireAuth } from '@/lib/auth'
import ChatContainer from '@/components/ChatContainer'

export const metadata = { title: 'Chat — Jarvis SECOM' }

export default async function ChatPage() {
  const user = await requireAuth()
  return (
    <main className="h-dvh w-full flex items-center justify-center overflow-hidden relative md:nebula-bg bg-base">
      <ChatContainer user={user} />
    </main>
  )
}
