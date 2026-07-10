import { NextRequest, NextResponse } from 'next/server';
import { Ollama } from 'ollama';
import { getSession } from '@/lib/auth';
import { DEFAULT_MODEL } from '@/lib/agent';
import { isSafeWhereFragment, ISO_DATE, SENTIMENTS } from '@/lib/sentimentos';

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
1. Responda APENAS com JSON: {"where": "<fragmento>", "descricao": "<resumo curto em PT-BR>", "sentiment": "<opcional>", "from": "<opcional>", "to": "<opcional>"}
2. O fragmento NÃO inclui a palavra WHERE, não usa ponto-e-vírgula, subquery ou outra tabela.
3. "Comentários SOBRE X" / "que falam de X" → LIKE no comment (e post_message se fizer sentido), com variações relevantes.
3b. "TEMA X" / "campanha(s) de X" / "eixo X" / "programa X" → o filtro é sobre a CAMPANHA, não sobre o texto do comentário: use ad_name e campaign_name, NUNCA comment. Combine a sigla do tema no ad_name com palavras do tema/programa no campaign_name (veja TEMAS abaixo).

TEMAS — Framework SECOM (a sigla do eixo/programa aparece dentro do ad_name, ex. 'SAÚDE NO INTERIOR | ... | SAU_NP_CARROSSEL_OBR_INF'):
- Eixos: SAU=Saúde, EDU=Educação, TRB=Trabalho, ECO=Economia, AMB=Meio Ambiente, INFRA=Infraestrutura, CUL=Cultura, MOB=Mobilidade, SEG=Segurança, INOV=Inovação, MUL=Mulheres, COMB=Combustíveis, JOV=Jovem
- Programas: SUS, MM=Mais Médicos, ATE=Agora Tem Especialistas, FP=Farmácia Popular, PDM=Pé de Meia, BF=Bolsa Família, CNH, GDP=Gás do Povo, MCMV=Minha Casa Minha Vida, E61=Escala 6x1, ENEM, LDP=Luz do Povo, IR=Isenção IR
- Os códigos só existem desde abril/2026, então SEMPRE combine com campaign_name LIKE usando nomes prováveis de campanha do tema (ex. saúde: '%saúde%', '%saude%', '%vacina%', '%especialistas%').

DATAS (para "from"/"to", relativas à data de hoje informada):
"este mês" → from=dia 1º do mês atual; "mês passado" → o mês anterior inteiro; "últimos N dias" → from=hoje−N; "semana passada" → segunda a domingo anteriores; "Q1/Q2/Q3/Q4 [ano]" → o trimestre; "[mês] de [ano]" → o mês inteiro.
4. Se o pedido indicar claramente um sentimento (positivo/negativo/neutro), inclua "sentiment" com um dos valores exatos Positivo, Negativo ou Neutro — e NÃO repita essa condição dentro de "where".
5. Se o pedido indicar um período (relativo, ex. "essa semana", "último mês", ou absoluto), inclua "from" e/ou "to" no formato YYYY-MM-DD — e NÃO repita essa condição via created_time dentro de "where".
6. Omita "sentiment"/"from"/"to" quando o pedido não indicar isso claramente.
7. "Reclamações"/"elogios"/"negativo"/"positivo" sobre um ASSUNTO é sinal de sentimento, não um segundo grupo de termos: coloque APENAS o assunto (ex.: '6x1') no where e o sentimento no campo "sentiment". NÃO adicione um grupo extra de palavras de opinião (ex. 'ruim', 'péssimo', 'absurdo', 'ótimo', 'cansativo') ANDado ao assunto — isso restringe demais e perde comentários relevantes. Um segundo grupo LIKE só é válido quando ele mesmo é parte do ASSUNTO (ex.: "preço" em "reclamações sobre preço de gasolina" é o assunto, não uma palavra de opinião).

Exemplos:
Pedido: "reclamações sobre preço de gasolina"
{"where":"(comment LIKE '%gasolina%' OR comment LIKE '%combustível%' OR comment LIKE '%combustivel%') AND (comment LIKE '%preço%' OR comment LIKE '%preco%' OR comment LIKE '%caro%' OR comment LIKE '%imposto%')","descricao":"Comentários sobre preço de gasolina/combustível"}
Pedido: "comentários com mais de 100 curtidas do último mês"
{"where":"like_count > 100 AND created_time >= DATE_SUB(NOW(), INTERVAL 1 MONTH)","descricao":"Comentários com 100+ curtidas nos últimos 30 dias"}
Pedido: "reclamações negativas essa semana"
{"where":"(comment LIKE '%reclam%' OR comment LIKE '%problema%' OR comment LIKE '%ruim%')","descricao":"Reclamações negativas desta semana","sentiment":"Negativo","from":"2026-07-03","to":"2026-07-09"}
Pedido: "reclamações sobre 6x1"
{"where":"(comment LIKE '%6x1%' OR comment LIKE '%escala 6x1%' OR comment LIKE '%jornada 6x1%')","descricao":"Reclamações sobre a escala de trabalho 6x1","sentiment":"Negativo"}
Pedido: "traga os comentários do tema saúde"
{"where":"(ad_name LIKE '%SAU_%' OR campaign_name LIKE '%saúde%' OR campaign_name LIKE '%saude%' OR campaign_name LIKE '%vacina%' OR campaign_name LIKE '%especialistas%' OR campaign_name LIKE '%mais médicos%' OR campaign_name LIKE '%farmácia popular%')","descricao":"Comentários em campanhas do tema Saúde"}
Pedido: "comentários da campanha do pé de meia"
{"where":"(ad_name LIKE '%PDM_%' OR campaign_name LIKE '%pé de meia%' OR campaign_name LIKE '%pe de meia%')","descricao":"Comentários das campanhas do Pé de Meia"}`;

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
    const today = new Date().toISOString().slice(0, 10);
    const response = await ollamaClient.chat({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Data de hoje: ${today}\nPedido: "${text.trim()}"` },
      ],
      stream: false,
    });
    const raw = response.message?.content ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('resposta sem JSON');
    const parsed = JSON.parse(jsonMatch[0]) as {
      where?: string;
      descricao?: string;
      sentiment?: string;
      from?: string;
      to?: string;
    };

    if (!parsed.where || !isSafeWhereFragment(parsed.where)) {
      console.warn('[sentimentos/ai-filter] fragmento rejeitado:', parsed.where);
      return NextResponse.json(
        { error: 'A IA não conseguiu gerar um filtro seguro para esse texto. Reformule.' },
        { status: 422 }
      );
    }
    const sentiment =
      parsed.sentiment && (SENTIMENTS as readonly string[]).includes(parsed.sentiment)
        ? parsed.sentiment
        : undefined;
    const from = parsed.from && ISO_DATE.test(parsed.from) ? parsed.from : undefined;
    const to = parsed.to && ISO_DATE.test(parsed.to) ? parsed.to : undefined;

    console.log(
      '[sentimentos/ai-filter]',
      JSON.stringify({ text: text.slice(0, 120), where: parsed.where, sentiment, from, to })
    );
    return NextResponse.json({ where: parsed.where, descricao: parsed.descricao ?? text.trim(), sentiment, from, to });
  } catch (e) {
    console.error('[sentimentos/ai-filter]', e);
    return NextResponse.json({ error: 'Falha ao interpretar o filtro com a IA' }, { status: 422 });
  }
}
