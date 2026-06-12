import { requireAuth } from "@/lib/auth";
import UserMenu from "@/components/UserMenu";
import MenuCard from "@/components/MenuCard";
import JarvisRing from "@/components/JarvisRing";

export const metadata = { title: "Início — Jarvis SECOM" };

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M3 5.5A2.5 2.5 0 0 1 5.5 3h11A2.5 2.5 0 0 1 19 5.5v8A2.5 2.5 0 0 1 16.5 16H13l-2 3-2-3H5.5A2.5 2.5 0 0 1 3 13.5v-8Z"
        stroke="var(--accent-text)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M7 8.5h8M7 11.5h5"
        stroke="var(--accent-text)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function VerificationIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M11 2.5L4 5.5v5c0 4.1 2.97 7.93 7 8.9 4.03-.97 7-4.8 7-8.9v-5L11 2.5Z"
        stroke="var(--accent-text)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 11l2.5 2.5 4.5-4.5"
        stroke="var(--accent-text)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default async function Home() {
  const user = await requireAuth();

  return (
    <main className="h-dvh w-full flex flex-col items-center justify-center overflow-hidden relative nebula-bg">
      <div className="absolute top-[max(1.25rem,env(safe-area-inset-top))] right-4 sm:right-6 z-20">
        <UserMenu user={user} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-7 sm:gap-10 px-4 sm:px-6 w-full max-w-2xl">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="mb-1">
            <JarvisRing />
          </div>
          <h1 className="text-[28px] font-semibold text-ink tracking-[-0.5px]">
            Jarvis
          </h1>
          <p className="text-sm text-ink-3">Assistente de dados da SECOM</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full">
          <MenuCard
            href="/chat"
            icon={<ChatIcon />}
            title="AI Chat"
            description="Consulte dados de campanhas e faça perguntas em linguagem natural"
          />
          <MenuCard
            href="/verification"
            icon={<VerificationIcon />}
            title="Verification"
            description="Acesse e analise relatórios de verification de mídia"
          />
        </div>
      </div>
    </main>
  );
}
