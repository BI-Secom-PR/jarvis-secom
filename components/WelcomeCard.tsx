export default function WelcomeCard() {
  return (
    <div className="rounded-[18px] bg-black/[0.28] border-[0.5px] border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] p-5 text-white/[0.68] text-sm leading-[1.7] tracking-[-0.1px]">
      Olá! 👋 Sou o <strong className="text-[rgba(120,180,255,0.95)]">Jarvis</strong>, assistente de dados da SECOM.
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
