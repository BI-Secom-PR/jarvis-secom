import { NextRequest, NextResponse } from 'next/server';
import { Ollama } from 'ollama';
import { getSession } from '@/lib/auth';
import { DEFAULT_MODEL } from '@/lib/agent';
import { isSafeWhereFragment } from '@/lib/sentimentos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ollamaClient = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  headers: process.env.OLLAMA_API_KEY
    ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }
    : {},
});

const SYSTEM = `Você converte um pedido em linguagem natural em UM fragmento de WHERE SQL (MySQL) sobre a tabela silver_social_comments de comentários de anúncios.

Colunas disponíveis (use SOMENTE estas):
- comment (texto do comentário), post_message (texto do post do anúncio), title, author
- platform ('instagram' | 'meta' | 'tiktok'), campaign_name, ad_name
- sentiment ('Positivo' | 'Negativo' | 'Neutro'), sentiment_source ('ai' | 'human')
- like_count (int), created_time (datetime), object_type ('VIDEO', 'PHOTO', ...)

Regras:
1. Responda APENAS com JSON: {"where": "<fragmento>", "descricao": "<resumo curto em PT-BR>"}
2. O fragmento NÃO inclui a palavra WHERE, não usa ponto-e-vírgula, subquery ou outra tabela.
3. Busca por assunto → LIKE no comment (e post_message se fizer sentido), com variações relevantes.
4. Datas relativas usam NOW()/DATE_SUB.

Exemplos:
Pedido: "reclamações sobre preço de gasolina"
{"where":"(comment LIKE '%gasolina%' OR comment LIKE '%combustível%' OR comment LIKE '%combustivel%') AND (comment LIKE '%preço%' OR comment LIKE '%preco%' OR comment LIKE '%caro%' OR comment LIKE '%imposto%')","descricao":"Comentários sobre preço de gasolina/combustível"}
Pedido: "comentários com mais de 100 curtidas do último mês"
{"where":"like_count > 100 AND created_time >= DATE_SUB(NOW(), INTERVAL 1 MONTH)","descricao":"Comentários com 100+ curtidas nos últimos 30 dias"}`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let text: string;
  try {
    ({ text } = await req.json());
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!text?.trim() || text.length > 500)
    return NextResponse.json({ error: 'Texto do filtro vazio ou longo demais' }, { status: 400 });

  try {
    const response = await ollamaClient.chat({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Pedido: "${text.trim()}"` },
      ],
      stream: false,
    });
    const raw = response.message?.content ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('resposta sem JSON');
    const parsed = JSON.parse(jsonMatch[0]) as { where?: string; descricao?: string };

    if (!parsed.where || !isSafeWhereFragment(parsed.where)) {
      console.warn('[sentimentos/ai-filter] fragmento rejeitado:', parsed.where);
      return NextResponse.json(
        { error: 'A IA não conseguiu gerar um filtro seguro para esse texto. Reformule.' },
        { status: 422 }
      );
    }
    console.log('[sentimentos/ai-filter]', JSON.stringify({ text: text.slice(0, 120), where: parsed.where }));
    return NextResponse.json({ where: parsed.where, descricao: parsed.descricao ?? text.trim() });
  } catch (e) {
    console.error('[sentimentos/ai-filter]', e);
    return NextResponse.json({ error: 'Falha ao interpretar o filtro com a IA' }, { status: 422 });
  }
}
