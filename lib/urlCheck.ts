import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { APICallError, generateText } from 'ai';
import { Ollama } from 'ollama';
import { isHomeRoot } from '@/lib/verification';

// Auditoria de brand safety das URLs amostradas — extraída de
// app/api/verification/run/route.ts. A checagem agora roda em chamadas curtas
// dirigidas pelo browser (POST /api/verification/url-check): a amostra da regra
// de share não cabe nos 300s de uma função só. Medido com os 29 verifs SENSE:
// 3.514 URLs ≈ 12 lotes ≈ 13-49 min, contra os 300s de teto da Vercel.

export type UrlSampleItem  = { url: string; categoria: string; veiculo: string; impressoes: number };
export type UrlAnomalyItem = { url: string; categoria: string; categoria_sugerida: string | null; veiculo: string; reason: string; impressoes: number; pct: number };
export type UrlCheckedRow  = UrlAnomalyItem & { status: 'CORRETA' | 'INCORRETA' };

// Dois provedores. URL_CHECK_OLLAMA_URL definido → Ollama próprio (servidor Secom,
// GPU de 2 GB: lento, por isso lotes pequenos e prazo longo); senão Google AI Studio,
// com a mesma chave do chat/RAG (Vercel: GOOGLE_GENERATIVE_AI_API_KEY; Keychain: JARVIS_API_GAIS).
const OLLAMA_URL = process.env.URL_CHECK_OLLAMA_URL;
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const ollama = OLLAMA_URL
  ? new Ollama({
      host: OLLAMA_URL,
      // ngrok-free põe uma página de aviso na frente de tráfego não-browser sem este header.
      headers: {
        'ngrok-skip-browser-warning': '1',
        ...(process.env.URL_CHECK_OLLAMA_AUTH ? { Authorization: process.env.URL_CHECK_OLLAMA_AUTH } : {}),
      },
    })
  : null;
// Medido ao vivo (10 URLs rotuladas, 2026-11-18): Google 3.5-flash-lite e 3.1-flash-lite 10/10;
// 3.5/3.7/3.8-flash devolveram 503 "high demand" e o Pro estoura a cota (chave free-tier).
// URL_CHECK_MODEL troca o modelo do provedor principal sem deploy (no modo Ollama é o tag, ex.: gemma4:e4b).
const OLLAMA_MODEL = process.env.URL_CHECK_MODEL ?? 'gemma4:e4b';
const GOOGLE_MODEL = (!ollama && process.env.URL_CHECK_MODEL) || 'gemini-3.5-flash-lite';

// The ~1.2k-token persona prompt used to be resent once per URL; grouping URLs
// into one call fixes that, and capping in-flight calls keeps us under the
// provider's rate limit.
const URLS_PER_CALL = Number(process.env.URL_CHECK_PER_CALL) || (ollama ? 3 : 10);
const URL_CHECK_CONCURRENCY = ollama ? 1 : 4;
// ponytail: wall-clock cap instead of a URL-count cap. maxDuration is 300s and a
// batch de 10 URLs mede ~33s, então uma amostra grande (SENSE junho: 794 URLs =
// ~20 rodadas = ~660s) estourava a função e o usuário não recebia nada. O prazo é
// absoluto desde a entrada do POST, então o tempo que o engine já gastou desconta
// sozinho; sobra folga para escrever a col 30 e devolver o xlsx.
export const URL_CHECK_BUDGET_MS = 200_000;
const OLLAMA_CALL_TIMEOUT_MS = 240_000;
const GOOGLE_CALL_TIMEOUT_MS = 75_000;
type UrlCheckOutcome = { rows: UrlCheckedRow[]; failed: number };

async function askOllama(content: string, maxOutputTokens: number, deadline: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      // think:false — o Gemma 4 raciocina por padrão e gasta o num_predict com resposta vazia.
      ollama!.chat({ model: OLLAMA_MODEL, think: false, keep_alive: '30m', options: { num_predict: maxOutputTokens, temperature: 0 }, messages: [{ role: 'user', content }] }),
      // Teto: nunca passar de deadline+70s (~270s), senão estoura o maxDuration de 300s da função.
      new Promise<never>((_, rej) => {
        const ms = Math.max(5_000, Math.min(OLLAMA_CALL_TIMEOUT_MS, deadline + 70_000 - Date.now()));
        timer = setTimeout(() => rej(new Error('ollama chat timeout')), ms);
      }),
    ]);
    return r.message.content.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function askGoogle(content: string, maxOutputTokens: number, deadline: number, tries = 3): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { text } = await generateText({
        model: google(GOOGLE_MODEL),
        prompt: content,
        maxOutputTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(GOOGLE_CALL_TIMEOUT_MS),
      });
      return text.trim();
    } catch (err) {
      const busy = APICallError.isInstance(err) && [429, 500, 502, 503, 504].includes(err.statusCode ?? 0);
      if (!busy || attempt >= tries - 1 || Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

// Fallback automático: se o servidor local falhar (laptop dormindo, ngrok offline, porteiro
// 401/502, Ollama parado, timeout), o lote segue no Google em vez de virar "não puderam ser
// verificadas". Depois da 1ª falha o Ollama é pulado por 60 s, para não pagar o erro (ou os
// 240 s do timeout) a cada lote. Sem chave do Google não há para onde cair: o erro sobe como antes.
const OLLAMA_SKIP_MS = 60_000;
let ollamaSkipUntil = 0;
const hasGoogleKey = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;

async function chatWithRetry(build: (via: 'ollama' | 'google') => string, maxOutputTokens: number, deadline: number): Promise<string> {
  if (ollama && Date.now() >= ollamaSkipUntil) {
    try {
      return await askOllama(build('ollama'), maxOutputTokens, deadline);
    } catch (err) {
      if (!hasGoogleKey) throw err;
      ollamaSkipUntil = Date.now() + OLLAMA_SKIP_MS;
      console.error(`[url-check] Ollama local falhou (${String(err).slice(0, 160)}); usando Google por ${OLLAMA_SKIP_MS / 1000}s`);
    }
  }
  // O prompt compacto foi ajustado para o Gemma; no Gemini ele errou um caso que o completo acerta (10/10).
  return askGoogle(build('google'), maxOutputTokens, deadline);
}

export function buildFullPrompt(items: UrlSampleItem[], categoriasDisponiveis: string[]): string {
  const list = items.map((it, i) => `${i + 1}. URL: ${it.url}\n   Categoria atribuída: ${it.categoria}`).join('\n');
  return `Você é um classificador especialista em Brand Safety e auditoria de mídia programática para a SECOM (Secretaria de Comunicação Social do Governo Federal do Brasil). 

Sua missão é auditar a classificação de conteúdo feita por um adserver. Dado uma URL, o título/conteúdo da página e a categoria atribuída pelo adserver, avalie se a classificação está CORRETA ou INCORRETA.

### DIRETRIZES DE AVALIAÇÃO (Regras de Negócio)

1. TRATAMENTO DE CATEGORIAS TÉCNICAS (Safeframe, Aplicativo Móvel, Teste de Tag):
   - O adserver frequentemente classifica URLs reais incorretamente como "safeframe", "aplicativo móvel" ou "teste de tag" devido a falhas de rastreamento.
   - Você DEVE analisar o conteúdo real da URL. Se a URL apontar para uma notícia, blog ou portal de conteúdo, e o adserver a classificou como "safeframe" (ou similar), isso é uma classificação INCORRETA (Erro de categorização técnica). Indique a categoria real do conteúdo.
   - Só considere CORRETA se a URL for genuinamente apenas um frame técnico isolado, sem conteúdo editorial visível.

1b. CATEGORIA "HOME" (página inicial):
   - "Home" é uma categoria VÁLIDA e DISTINTA: é a página raiz do site (sem caminho interno), ex.: https://www.uol.com.br/, https://g1.globo.com/.
   - Home NÃO é Notícias/Editorial. Nunca sugira uma categoria de conteúdo (Notícias, Política, Esportes…) para uma URL raiz classificada como "Home" — isso é CORRETA.
   - Se a URL aponta para uma página interna (matéria, seção, com caminho após o domínio) mas foi classificada como "Home", isso é INCORRETA — sugira a categoria real do conteúdo.

2. CONTEXTO DOMINANTE VS. PALAVRAS-CHAVE: Não classifique uma página como "indevida" apenas pela presença de palavras-chave isoladas. Analise o CONTEXTO DOMINANTE. 
   - Matérias jornalísticas, artigos de opinião política, análises históricas, avanços tecnológicos, geopolítica ou notícias de segurança pública NÃO devem ser classificados automaticamente como "Violência" ou "Crimes", a menos que haja exposição gráfica, apologia ou sensacionalismo extremo.

### CATEGORIAS INDEVIDAS DA SECOM (Definições Estritas)
- Língua estrangeira: Conteúdo principal fora do português brasileiro.
- Conteúdo adulto: Sexo explícito, pornografia, erotismo e afins.
- Violência: Imagens ou descrições explícitas de acidentes violentos, armas, mortes brutais, apologia à guerra. (Geopolítica, história militar, tecnologia de defesa ou notícias cotidianas de portais de grande mídia NÃO são violência).
- Crimes: Apologia ao crime, violação grave de direitos. (Atividade policial padrão ou notícias jurídicas/jornalísticas NÃO são crimes).
- Pirataria: Links e métodos para distribuição ilegal de conteúdo protegido.
- Terrorismo: Propaganda, recrutamento ou apologia a grupos extremistas/ataques.
- Discurso de ódio: Conteúdo explicitamente discriminatório (raça, gênero, religião, orientação sexual, etc.).
- Conteúdo gerado pelo usuário sem moderação: Fóruns abertos, chats anonimizados (alto risco de pedofilia/crimes).
- Drogas: Apologia, comércio ou tutorial de uso de substâncias ilícitas.

### INSTRUÇÕES DE SAÍDA (Formato de Resposta)
Você deve seguir estritamente o formato JSON abaixo para sua resposta. Pense passo a passo antes de definir o status.

{
  "analise_contexto": "Explique brevemente o foco principal da URL e o que de fato há na página.",
  "justificativa_brand_safety": "Avalie se o adserver errou a classificação (seja por falso positivo de Brand Safety ou por erro de categoria técnica como safeframe).",
  "status": "CORRETA" ou "INCORRETA",
  "categoria_sugerida": "Manter a atual se o status for CORRETA, ou indicar a categoria real (ex: 'Notícias', 'Tecnologia', 'Política') se for INCORRETA."
}

### EXEMPLOS PARA APRENDIZADO (Few-Shot)

Exemplo 1 (Falso Positivo de safeframe):
- URL: https://g1.globo.com/politica/noticia/2026/06/governo-anuncia-novas-medidas-economicas.html
- Categoria do Adserver: safeframe
- Resposta esperada:
{
  "analise_contexto": "A URL aponta para uma notícia jornalística real do portal G1 sobre política e economia governamental.",
  "justificativa_brand_safety": "INCORRETA. O adserver classificou erroneamente como 'safeframe' devido a uma limitação técnica de rastreamento no momento do leilão, mas a URL contém conteúdo editorial legítimo que deveria ser mapeado.",
  "status": "INCORRETA",
  "categoria_sugerida": "Política / Economia"
}

Exemplo 2 (Falso Positivo de Violência):
- URL: https://revistaforum.com.br/revista-forum/nem-portos-nem-barreiras-maior-marinha-do-mundo-cria-sistema-para-desembarcar-em-qualquer-costa/
- Categoria do Adserver: Violência
- Resposta esperada:
{
  "analise_contexto": "O artigo aborda um avanço tecnológico e logístico da marinha, focado em estratégia e engenharia.",
  "justificativa_brand_safety": "INCORRETA. Falso positivo. A presença de termos militares acionou o gatilho de 'Violência' do adserver, mas o texto não contém violência gráfica ou conflito armado. Trata-se de inovação/geopolítica.",
  "status": "INCORRETA",
  "categoria_sugerida": "Tecnologia / Geopolítica"
}
${categoriasDisponiveis.length > 0 ? `
Categorias usadas neste arquivo de verificação (prefira sugerir uma destas, ou uma categoria indevida do SECOM acima):
${categoriasDisponiveis.map((c) => `- ${c}`).join('\n')}
` : ''}
### AVALIE TODAS AS URLS ABAIXO
Responda APENAS com um array JSON, um objeto por URL, na mesma ordem, com "i" igual ao número da URL. Sem texto fora do array.
[{"i":1,"status":"CORRETA","categoria_sugerida":"...","justificativa_brand_safety":"..."}]

${list}`;
}

// Versão enxuta para o modelo local (CPU/GPU de 2 GB: cada token de prompt e de saída custa segundo).
// Um só formato de saída, sem few-shot, regras condensadas, justificativa de uma frase.
export function buildCompactPrompt(items: UrlSampleItem[], categoriasDisponiveis: string[]): string {
  const list = items.map((it, i) => `${i + 1}. ${it.url} | categoria atribuída: ${it.categoria}`).join('\n');
  return `Você audita a categoria que um adserver atribuiu a URLs (Brand Safety, SECOM / Governo Federal do Brasil). Julgue pela URL. Para cada uma, diga se a categoria atribuída está CORRETA ou INCORRETA.

Regra principal: você audita se a CLASSIFICAÇÃO está certa, não se o conteúdo é bom. Se a categoria atribuída descreve fielmente o que a URL é, ela é CORRETA, mesmo sendo uma categoria indevida (ex.: um site de pornografia classificado como "Conteúdo adulto" está CORRETO). INCORRETA é quando a categoria não descreve a URL.

Regras:
- "safeframe", "aplicativo móvel" e "teste de tag" são falhas técnicas de rastreamento. Se a URL é de notícia, blog ou portal com conteúdo editorial, é INCORRETA (sugira a categoria real). Só é CORRETA se for um frame técnico sem conteúdo.
- "Home" = página raiz sem caminho (ex.: https://g1.globo.com/) → CORRETA. "Home" em URL com caminho interno → INCORRETA.
- Não marque Violência/Crimes por palavra-chave: notícia, política, geopolítica, polícia e jornalismo comum NÃO são violência nem crime, salvo conteúdo gráfico, apologia ou sensacionalismo extremo.
- Categorias indevidas: Língua estrangeira (conteúdo fora do português), Conteúdo adulto, Violência, Crimes, Pirataria (download/streaming ilegal), Terrorismo, Discurso de ódio, Conteúdo gerado pelo usuário sem moderação (fóruns/chats), Drogas.${categoriasDisponiveis.length > 0 ? `
- Categorias deste arquivo (prefira sugerir uma destas): ${categoriasDisponiveis.join(', ')}.` : ''}

Responda SOMENTE com um array JSON, um objeto por URL, na ordem, sem texto fora do array.
INCORRETA: [{"i":1,"status":"INCORRETA","categoria_sugerida":"categoria real","justificativa_brand_safety":"uma frase curta"}]
CORRETA (deixe os dois campos vazios, não explique): [{"i":2,"status":"CORRETA","categoria_sugerida":"","justificativa_brand_safety":""}]

${list}`;
}

/**
 * Audits a chunk of URLs in a single model call.
 *
 * Anything that stops a URL from actually being judged — transport error, an
 * unparseable reply, a missing entry in the array — is counted in `failed`
 * rather than dropped. A silently swallowed failure reads as "URL is fine",
 * which is the one answer this check must never invent.
 */
async function checkUrlChunk(items: UrlSampleItem[], categoriasDisponiveis: string[], deadline: number): Promise<UrlCheckOutcome> {
  const build = (via: 'ollama' | 'google') =>
    (via === 'ollama' && process.env.URL_CHECK_PROMPT !== 'full' ? buildCompactPrompt : buildFullPrompt)(items, categoriasDisponiveis);

  let parsed: { i?: number; status?: string; categoria_sugerida?: string; justificativa_brand_safety?: string }[];
  try {
    const raw = (await chatWithRetry(build, 220 * items.length, deadline))
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '');
    const arr: unknown = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    if (!Array.isArray(arr)) throw new Error('not an array');
    parsed = arr as typeof parsed;
  } catch (err) {
    console.error(`[url-check] chunk of ${items.length} failed: ${String(err).slice(0, 200)}`);
    return { rows: [], failed: items.length };
  }

  const rows: UrlCheckedRow[] = [];
  let failed = 0;
  items.forEach((item, idx) => {
    const entry = parsed.find((e) => e.i === idx + 1) ?? parsed[idx];
    const status = (entry?.status ?? '').trim().toUpperCase();
    if (!entry || (status !== 'CORRETA' && status !== 'INCORRETA')) { failed++; return; }
    rows.push({
      url: item.url,
      categoria: item.categoria,
      categoria_sugerida: entry.categoria_sugerida?.trim() || null,
      veiculo: item.veiculo,
      reason: entry.justificativa_brand_safety?.trim() || (status === 'CORRETA' ? '' : 'Classificação suspeita'),
      impressoes: item.impressoes,
      pct: 0,
      status,
    });
  });
  return { rows, failed };
}

/**
 * Audita um bloco de URLs até o prazo vencer.
 *
 * Devolve `checked` — quantas foram efetivamente processadas. Pode ser menor
 * que items.length: é o que permite ao cliente retomar de onde parou em vez de
 * perder o lote inteiro quando o modelo está lento.
 */
export async function checkUrls(
  items: UrlSampleItem[],
  categorias: string[],
  deadline: number,
): Promise<{ rows: UrlCheckedRow[]; checked: number; failed: number }> {
  // URL raiz classificada como "Home" está correta por definição — resolver
  // aqui evita a chamada à IA (que sugeria "Notícias" ao ler o portal).
  const rows: UrlCheckedRow[] = [];
  const toCheck: UrlSampleItem[] = [];
  for (const item of items) {
    if (isHomeRoot(item.url, item.categoria)) {
      rows.push({ ...item, categoria_sugerida: null, reason: 'Home = raiz do site (regra determinística, sem IA)', pct: 0, status: 'CORRETA' });
    } else {
      toCheck.push(item);
    }
  }
  if (toCheck.length === 0 || (!ollama && !process.env.GOOGLE_GENERATIVE_AI_API_KEY)) {
    return { rows, checked: items.length, failed: 0 };
  }

  const chunks: UrlSampleItem[][] = [];
  for (let i = 0; i < toCheck.length; i += URLS_PER_CALL) chunks.push(toCheck.slice(i, i + URLS_PER_CALL));

  // Resultado por chunk, não acumulado: só o prefixo de chunks concluídos conta,
  // e para achá-lo é preciso saber quais índices fecharam.
  const chunkRows: (UrlCheckedRow[] | null)[] = new Array(chunks.length).fill(null);
  const chunkFailed: number[] = new Array(chunks.length).fill(0);

  let next = 0;
  const worker = async () => {
    while (next < chunks.length && Date.now() < deadline) {
      const idx = next++;
      const r = await checkUrlChunk(chunks[idx], categorias, deadline);
      // Chunk que falhou inteiro já com o prazo vencido foi cortado, não julgado:
      // o modelo nem chegou a responder. Deixá-lo fora do prefixo faz o cliente
      // reenviar essas URLs no próximo lote — contá-las como `failed` gastaria a
      // auditoria delas sem nunca ter perguntado nada à IA.
      if (r.rows.length === 0 && r.failed > 0 && Date.now() > deadline) continue;
      chunkRows[idx] = r.rows;
      chunkFailed[idx] = r.failed;
    }
  };
  await Promise.all(Array.from({ length: Math.min(URL_CHECK_CONCURRENCY, chunks.length) }, worker));

  // Prefixo de chunks concluídos. Os workers pegam chunks em ordem mas terminam
  // fora dela: sem cortar no primeiro buraco, `checked` passaria por cima de um
  // chunk que ninguém auditou.
  let k = 0;
  while (k < chunks.length && chunkRows[k] !== null) k++;
  const done = chunks.slice(0, k).reduce((n, c) => n + c.length, 0);
  for (let i = 0; i < k; i++) rows.push(...chunkRows[i]!);
  const failed = chunkFailed.slice(0, k).reduce((a, b) => a + b, 0);

  // `done` conta as URLs auditadas a partir do início de toCheck. O cliente
  // avança por `checked` dentro de `items`, e as resolvidas por regra (home)
  // ficam intercaladas com as auditadas — somar as duas contagens daria um
  // índice à frente do prefixo realmente resolvido e pularia URLs em silêncio.
  // Daí caminhar `items` até esgotar o `done` e devolver o prefixo exato.
  let audited = 0;
  let checked = 0;
  for (const item of items) {
    if (!isHomeRoot(item.url, item.categoria)) {
      if (audited >= done) break;
      audited++;
    }
    checked++;
  }

  // Descarta o que ficou além do prefixo: o cliente vai reenviar essas URLs no
  // próximo lote, e linhas repetidas inflariam a lista de anomalias.
  const dentro = new Set(items.slice(0, checked).map((i) => `${i.veiculo} ${i.categoria} ${i.url}`));
  const prefixRows = rows.filter((r) => dentro.has(`${r.veiculo} ${r.categoria} ${r.url}`));

  if (checked < items.length) console.warn(`[url-check] prazo esgotado: ${checked}/${items.length}`);
  return { rows: prefixRows, checked, failed };
}
