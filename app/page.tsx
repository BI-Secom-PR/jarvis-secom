import { requireAuth } from "@/lib/auth";
import UserMenu from "@/components/UserMenu";
import HudPanel from "@/components/HudPanel";
import HudBackground from "@/components/HudBackground";

export const metadata = { title: "Início — Jarvis SECOM" };

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M3 5.5A2.5 2.5 0 0 1 5.5 3h11A2.5 2.5 0 0 1 19 5.5v8A2.5 2.5 0 0 1 16.5 16H13l-2 3-2-3H5.5A2.5 2.5 0 0 1 3 13.5v-8Z"
        stroke="var(--hud-cyan)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M7 8.5h8M7 11.5h5"
        stroke="var(--hud-cyan)"
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
        stroke="var(--hud-gold)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 11l2.5 2.5 4.5-4.5"
        stroke="var(--hud-gold)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SentimentIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M3 5.5A2.5 2.5 0 0 1 5.5 3h11A2.5 2.5 0 0 1 19 5.5v8A2.5 2.5 0 0 1 16.5 16H13l-2 3-2-3H5.5A2.5 2.5 0 0 1 3 13.5v-8Z"
        stroke="var(--hud-violet)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M11 12.3l-2.6-2.55a1.55 1.55 0 0 1 2.2-2.2l.4.4.4-.4a1.55 1.55 0 0 1 2.2 2.2L11 12.3Z"
        stroke="var(--hud-violet)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default async function Home() {
  const user = await requireAuth();

  return (
    <main className="hud-theme hud-void-bg hud-scanlines relative h-dvh w-full overflow-hidden">
      <HudBackground variant="full" />

      <div className="absolute top-[max(1.25rem,env(safe-area-inset-top))] right-4 sm:right-6 z-20">
        <UserMenu user={user} />
      </div>

      {/* Hero wordmark — top-center, over the lattice */}
      <div className="absolute inset-x-0 top-[max(3.5rem,env(safe-area-inset-top))] z-10 flex flex-col items-center gap-2 px-4 text-center">
        <h1
          className="font-hud text-[26px] sm:text-[34px] font-bold uppercase tracking-[0.42em] text-ink animate-hud-flicker motion-reduce:animate-none"
          style={{ textShadow: "0 0 22px color-mix(in srgb, var(--hud-cyan) 45%, transparent)" }}
        >
          Jarvis
        </h1>
        <p className="font-hud text-[9px] sm:text-[10px] uppercase tracking-[0.4em] text-ink-3">
          SECOM · Command Lattice
        </p>
      </div>

      {/* HUD panels — corners on desktop, stacked centered on mobile */}
      <div className="absolute inset-x-0 bottom-[max(4.5rem,env(safe-area-inset-bottom))] z-10 flex flex-col items-center gap-3 px-5 md:flex-row md:items-end md:justify-between md:px-[6vw]">
        <HudPanel
          href="/chat"
          icon={<ChatIcon />}
          title="Chat"
          subtitle="Consulte dados de campanhas e faça perguntas em linguagem natural"
          accent="cyan"
          className="w-full max-w-sm md:w-[320px]"
        />
        <HudPanel
          href="/sentimentos"
          icon={<SentimentIcon />}
          title="Sentimentos"
          subtitle="Analise o sentimento dos comentários dos anúncios e corrija classificações"
          accent="violet"
          className="w-full max-w-sm md:w-[320px]"
        />
        <HudPanel
          href="/verification"
          icon={<VerificationIcon />}
          title="Verification"
          subtitle="Acesse e analise relatórios de verificação de mídia"
          accent="gold"
          className="w-full max-w-sm md:w-[320px]"
        />
      </div>

      {/* Footer */}
      <p
        className="absolute inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-10 px-4 text-center font-hud text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.5em]"
        style={{ color: "var(--accent-text)", textShadow: "0 0 14px color-mix(in srgb, var(--hud-cyan) 50%, transparent)" }}
      >
        JARVIS · Assistente de dados da SECOM
      </p>
    </main>
  );
}
