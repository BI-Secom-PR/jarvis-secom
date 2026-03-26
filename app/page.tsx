import { requireAuth } from "@/lib/auth";
import UserMenu from "@/components/UserMenu";
import MenuCard from "@/components/MenuCard";

export const metadata = { title: "Início — Jarvis SECOM" };

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M3 5.5A2.5 2.5 0 0 1 5.5 3h11A2.5 2.5 0 0 1 19 5.5v8A2.5 2.5 0 0 1 16.5 16H13l-2 3-2-3H5.5A2.5 2.5 0 0 1 3 13.5v-8Z"
        stroke="rgba(120,180,255,0.82)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M7 8.5h8M7 11.5h5"
        stroke="rgba(120,180,255,0.82)"
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
        stroke="rgba(120,180,255,0.82)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 11l2.5 2.5 4.5-4.5"
        stroke="rgba(120,180,255,0.82)"
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
    <main className="h-screen w-screen flex flex-col items-center justify-center overflow-hidden relative nebula-bg">
      <div className="absolute top-5 right-6 z-20">
        <UserMenu user={user} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-10 px-6 w-full max-w-2xl">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-12 h-12 rounded-full bg-white/[0.07] border-[0.5px] border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] flex items-center justify-center mb-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="4" fill="rgba(120,180,255,0.7)" />
              <circle
                cx="10"
                cy="10"
                r="7"
                stroke="rgba(120,180,255,0.25)"
                strokeWidth="1"
              />
            </svg>
          </div>
          <h1 className="text-[28px] font-semibold text-white tracking-[-0.5px]">
            Jarvis
          </h1>
          <p className="text-sm text-white/40">Assistente de dados da SECOM</p>
        </div>

        <div className="grid grid-cols-2 gap-4 w-full">
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
