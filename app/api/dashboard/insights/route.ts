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

const MAX_RESUMO = 12_000;

/** Eficiência que faz sentido citar para cada métrica — o modelo não escolhe sozinho. */
const EFICIENCIA: Record<MetricKey, string> = {
  investimento: 'participação no gasto e CPM (custo por mil impressões)',
  impressoes: 'CPM (custo por mil impressões)',
  alcance: 'CPM e frequência (impressões ÷ alcance)',
  cliques: 'CPC (custo ÷ cliques) e CTR (cliques ÷ impressões)',
  visualizacoes: 'CPV (custo ÷ visualizações) e VTR (visualizações ÷ impressões)',
  engajamento: 'custo por interação e taxa de engajamento sobre impressões',
  ctr: 'a própria taxa comparada à média do recorte',
};

const ESCOPO: Record<string, string> = {
  campanhas: 'campanhas e anúncios (com a plataforma de cada um)',
  demografia: 'faixas etárias e gêneros',
  regiao: 'unidades federativas',
};

function buildSystem(tab: string, metric: MetricKey): string {
  const label = METRICS[metric].label;
  return `Você é analista de mídia da SECOM lendo um recorte já filtrado do dashboard.

A MÉTRICA ATIVA É "${label}". Toda frase analisa ${label} sobre ${ESCOPO[tab]}.
- A PRIMEIRA frase é obrigatoriamente quem lidera ${label} — com o valor e a eficiência: ${EFICIENCIA[metric]}.
- As demais apontam o que performa melhor ou pior em ${label}, quem destoa, e a variação contra o período anterior quando ele vier no payload.
- NUNCA cite CPM se a métrica ativa não for Impressões, Alcance ou Investimento.

Regras dos dados:
- Engajamento = curtidas + comentários + compartilhamentos + reações + salvos. Ignore qualquer outra definição.
- Valores monetários em reais (BRL).
- Zero em visualizações/quartis significa que a plataforma não reporta, não que ninguém assistiu — não trate como fracasso.
- Use SOMENTE números presentes nos dados recebidos. Não invente campanha, plataforma, período ou valor.
- Se um número não estiver nos dados, simplesmente não fale dele. Nunca escreva que algo "não foi fornecido", nem cite payload, JSON ou campos.

Formato: responda APENAS com JSON {"insights": ["frase 1", "frase 2", "frase 3"]}.
De 3 a 4 frases, português do Brasil, cada uma com no máximo 200 caracteres, sem markdown, sem bullets, sem títulos.`;
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
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 240))
      .slice(0, 4);
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
