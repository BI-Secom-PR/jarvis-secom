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

function buildSystem(tab: string, metric: MetricKey): string {
  const label = METRICS[metric].label;
  return `Você é analista de mídia da SECOM. Os achados já foram calculados — você SÓ redige.

Métrica ativa: ${label}. Escopo: ${ESCOPO[tab]}.
- Reescreva cada achado em UMA frase fluente. Pode fundir no máximo dois achados vizinhos.
- NÃO altere números, nomes, sinais (+/−) nem o sentido.
- NÃO invente campanha, plataforma, período ou valor.
- NÃO descreva último lugar em volume ("menor entrega", "menor volume").
- Anomalia (cobertura/base) NÃO é tendência de crescimento.
- mix_vs_rate vem antes do líder. recomendacao, se houver, fecha.
- Nunca escreva que algo "não foi fornecido", nem cite payload, JSON, tipo do achado ou campos.

Formato: responda APENAS com JSON {"insights": ["frase 1", "frase 2", "frase 3"]}.
De 3 a 4 frases, português do Brasil, cada uma com no máximo 220 caracteres, sem markdown, sem bullets, sem títulos.`;
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
