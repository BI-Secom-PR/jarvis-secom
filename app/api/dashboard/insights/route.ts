import { NextRequest, NextResponse } from 'next/server';
import { Ollama } from 'ollama';
import { getSession } from '@/lib/auth';
import { DEFAULT_MODEL } from '@/lib/agent';
import { isMetricKey, METRICS, type MetricKey } from '@/lib/dashboard';
import { rateLimit, clientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ollamaClient = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  headers: process.env.OLLAMA_API_KEY
    ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }
    : {},
});

const MAX_RESUMO = 8_000;

const ESCOPO: Record<string, string> = {
  campanhas: 'campanhas e plataformas',
  demografia: 'faixas etárias e gêneros',
  regiao: 'unidades federativas',
};

const MAX_FRASE = 360;

// O que é próprio de cada aba dimensional: composição (pp), não performance.
const REGRAS_ABA: Record<string, string> = {
  demografia: `- "pp" são pontos percentuais de participação no mix, não variação percentual.
- Faixa e gênero entregues NÃO são o público-alvo: só diga "fora do alvo" onde o achado disser.
- Mix, viés de plataforma e aderência ao alvo são leituras de composição; não as trate como desempenho.
- Só cite ressalvas (faixas aproximadas, filtro de rede) se estiverem escritas no achado; nunca acrescente uma que o achado não traz.`,
  regiao: `- "pp" são pontos percentuais de participação no mix, não variação percentual.
- O índice de penetração compara a entrega com a população (Censo 2022): é estimativa, não meta; se o achado traz a ressalva de alvo regional, mantenha-a, e não acrescente outras.
- Não chame uma UF de baixa entrega de ruim sem citar o índice ou o custo unitário do achado.`,
};

function buildSystem(tab: string, metric: MetricKey): string {
  const label = METRICS[metric].label;
  return `Você é analista de mídia da SECOM. Os achados já foram calculados — você SÓ redige.

Métrica ativa: ${label}. Escopo: ${ESCOPO[tab]}.
- Cada achado tem um "bloco" (tendencia, dia, referencia, plataformas, redes, campanhas, anuncios, distribuicao, eficiencia, cobertura, recomendacao). Reescreva cada achado em UMA frase fluente e devolva com o MESMO bloco, na MESMA ordem. Não funda blocos diferentes nem crie blocos.
- NÃO altere números, nomes, sinais (+/−), multiplicadores (×) nem o sentido.
- NÃO invente campanha, plataforma, anúncio, período ou valor.
- NÃO descreva último lugar em volume ("menor entrega", "menor volume").
- Anomalia (cobertura/base) NÃO é tendência de crescimento.
- Recomendação é estimativa linear: mantenha a palavra "estimativa" e a ressalva de objetivo.
- Referência compara o foco (campanha ou plataforma) com as demais do mesmo recorte: mantenha a ressalva de objetivos diferentes.
- Nunca escreva que algo "não foi fornecido", nem cite payload, JSON, tipo do achado ou campos.
${REGRAS_ABA[tab] ?? ''}
Formato: responda APENAS com JSON {"insights": [{"bloco": "...", "frase": "..."}]}.
Uma frase por achado, português do Brasil, cada uma com no máximo ${MAX_FRASE} caracteres, sem markdown, sem bullets, sem títulos.`;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit(`insights:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Muitas leituras seguidas. Aguarde um instante.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

  const tab = String(body.tab ?? '');
  const metric = body.metric;
  if (!ESCOPO[tab] || !isMetricKey(metric))
    return NextResponse.json({ error: 'Aba ou métrica inválida' }, { status: 400 });

  const resumo = JSON.stringify(body.resumo ?? null);
  if (resumo === 'null' || resumo.length > MAX_RESUMO)
    return NextResponse.json({ error: 'Resumo vazio ou grande demais' }, { status: 400 });

  const contexto = JSON.stringify({ periodo: body.periodo, filtros: body.filtros });

  try {
    const raw = await chatWithRetry(buildSystem(tab, metric), `Contexto: ${contexto}\nDados: ${resumo}`);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('resposta sem JSON');
    const parsed = JSON.parse(jsonMatch[0]) as { insights?: unknown };
    const insights = (Array.isArray(parsed.insights) ? parsed.insights : [])
      .filter((x): x is { bloco: string; frase: string } =>
        !!x && typeof x === 'object' && typeof (x as { bloco?: unknown }).bloco === 'string'
        && typeof (x as { frase?: unknown }).frase === 'string' && (x as { frase: string }).frase.trim().length > 0)
      .map((x) => ({ bloco: x.bloco, frase: x.frase.trim().slice(0, MAX_FRASE) }))
      .slice(0, 9);
    if (!insights.length) throw new Error('nenhuma frase utilizável');
    return NextResponse.json({ insights });
  } catch (e) {
    console.error('[dashboard/insights]', e);
    return NextResponse.json({ error: 'Falha ao gerar a leitura com a IA' }, { status: 422 });
  }
}

/** A nuvem do ollama recusa sob carga — um retry basta (mesmo tratamento de verification/run). */
async function chatWithRetry(system: string, user: string, tries = 2): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await ollamaClient.chat({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
      });
      return response.message?.content ?? '';
    } catch (err) {
      const busy = String(err).includes('too many concurrent requests');
      if (!busy || attempt >= tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
