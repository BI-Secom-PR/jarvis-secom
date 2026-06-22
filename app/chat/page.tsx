import { requireAuth } from '@/lib/auth'
import ChatContainer from '@/components/ChatContainer'
import HudBackground from '@/components/HudBackground'

export const metadata = { title: 'Chat — Jarvis SECOM' }

export default async function ChatPage() {
  const user = await requireAuth()
  return (
    <main className="hud-theme hud-void-bg relative flex h-dvh w-full items-center justify-center overflow-hidden">
      <HudBackground variant="subtle" />
      <ChatContainer user={user} />
    </main>
  )
}
