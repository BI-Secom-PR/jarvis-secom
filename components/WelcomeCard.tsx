export default function WelcomeCard() {
  return (
    <div className="rounded-[18px] bg-fill border-[0.5px] border-separator shadow-(--shadow-bubble) p-4 md:p-5 text-ink-2 text-sm leading-[1.7] tracking-[-0.1px]">
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
