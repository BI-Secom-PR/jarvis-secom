import HudCorners from "./HudCorners";

export default function WelcomeCard() {
  return (
    <div className="relative rounded-[14px] hud-panel p-5 md:p-6 text-ink-2 text-sm leading-[1.7] tracking-[-0.1px] self-start max-w-[94%] md:max-w-[88%]">
      <HudCorners accent="cyan" size={14} inset={6} />
      <div
        className="font-hud text-[9px] uppercase tracking-[0.32em] text-accent-text mb-3 flex items-center gap-2"
        style={{ textShadow: "0 0 10px rgba(39,224,255,0.4)" }}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse-green" />
        Sistema online
      </div>
      Olá! 👋 Sou o <strong className="text-accent-text">Jarvis</strong>, assistente de dados da SECOM.
      <br /><br />
      Posso consultar dados de campanhas digitais e responder perguntas como:
      <ul className="pl-5 mt-2 space-y-1" style={{ listStyleType: 'disc' }}>
        <li>Quais campanhas tiveram mais cliques?</li>
        <li>Qual o CTR por plataforma?</li>
        <li>Compare desempenho por região</li>
        <li>Gere um gráfico de impressões por campanha</li>
      </ul>
      <br />
      Como posso te ajudar?
    </div>
  );
}
