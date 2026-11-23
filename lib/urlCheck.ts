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
export type UrlCheckedRow  = UrlAnomalyItem & { status: 'CORRETA' | 'INCORRETA'; source?: string };

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

async function chatWithRetry(build: (via: 'ollama' | 'google') => string, maxOutputTokens: number, deadline: number): Promise<{ text: string; source: string }> {
  if (ollama && Date.now() >= ollamaSkipUntil) {
    try {
      return { text: await askOllama(build('ollama'), maxOutputTokens, deadline), source: `ollama:${OLLAMA_MODEL}` };
    } catch (err) {
      if (!hasGoogleKey) throw err;
      ollamaSkipUntil = Date.now() + OLLAMA_SKIP_MS;
      console.error(`[url-check] Ollama local falhou (${String(err).slice(0, 160)}); usando Google por ${OLLAMA_SKIP_MS / 1000}s`);
    }
  }
  // O prompt compacto foi ajustado para o Gemma; no Gemini ele errou um caso que o completo acerta (10/10).
  return { text: await askGoogle(build('google'), maxOutputTokens, deadline), source: `google:${GOOGLE_MODEL}` };
}

// Duas etapas: o modelo só descreve (família do rótulo × família da página) e o código compara.
// Pedir o veredito direto fazia o LLM acusar "Ciência" em notícia de futebol (divergência comum×comum,
// que a equipe manda ignorar) e tolerar "Violência" em pauta sem relação com crime. Medido em 193 URLs
// revisadas pela equipe — ver scripts/eval-url-prompt.ts.
const FAMILIAS = `Informe "pagina": o que a URL realmente é (olhe o ASSUNTO PRINCIPAL, não a categoria atribuída). O sistema compara com a categoria e calcula o veredito.
- violencia: crime violento noticiado (homicídio, feminicídio, agressão, estupro, sequestro, tiroteio, tortura), morte violenta, acidente com morte ou vítima grave, pessoa desaparecida encontrada morta, violência explícita — mesmo sem imagem gráfica. NÃO é violencia: morte natural, desaparecido encontrado vivo, acidente sem morte nem vítima grave, política, geopolítica/guerra como análise, tecnologia de defesa, celebridade, e história/ditadura/massacre tratados como memória ou análise (só é violencia se a página DESCREVE a violência).
- seguranca: notícia de crime sem violência explícita, polícia (prisões, operações, furtos), justiça criminal, sistema prisional, fiscalização, política de segurança pública.
- adulto: nudez, sexo, erotismo, ensaio sensual (inclusive de celebridades), conteúdo sexual.
- estrangeiro: conteúdo principal em outra língua que não o português. Página em português (do Brasil ou de Portugal, inclusive /pt) NÃO é estrangeiro.
- drogas: uso, tráfico, overdose, apologia. Cannabis medicinal, regulação e debate legal são comum.
- tecnica: frame, tag ou chamada de anúncio sem conteúdo editorial.
- comum: todo o resto. Pirataria também é comum (fora do escopo).
A categoria atribuída só importa em dois casos: ser restritiva/indevida (Violência, Segurança, Adulto, Idioma estrangeiro…) ou técnica (Safeframe…). Divergência entre duas categorias comuns (Saúde x Entretenimento, Ciência x Esportes) NÃO importa: não comente.
Preencha também "status" com o seu melhor julgamento.`;

export type RotuloFam = 'comum' | 'restritivo' | 'adulto' | 'estrangeiro' | 'tecnica' | 'home';
export type PaginaFam = 'comum' | 'seguranca' | 'violencia' | 'adulto' | 'estrangeiro' | 'drogas' | 'tecnica';
const ROTULOS = ['comum', 'restritivo', 'adulto', 'estrangeiro', 'tecnica', 'home'];
const PAGINAS = ['comum', 'seguranca', 'violencia', 'adulto', 'estrangeiro', 'drogas', 'tecnica'];
const norm = (v?: string) => (v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Família da categoria atribuída, pelo nome (determinístico — pedir ao LLM confundia rótulo com página). */
export function rotuloFamily(categoria: string): RotuloFam {
  const c = norm(categoria);
  if (/^(safeframe|aplicativo movel|teste de tag|teste banner|entrega em wifi)$/.test(c)) return 'tecnica';
  if (c === 'home') return 'home';
  if (/sex|pornograf|adulto|erot/.test(c)) return 'adulto';
  if (/estrangeir|idioma/.test(c)) return 'estrangeiro';
  if (/violen|crime|acidente|policial|seguranca|sensive|armas|droga/.test(c)) return 'restritivo';
  return 'comum';
}

/** Veredito determinístico a partir das duas famílias; null se o modelo não preencheu a página direito. */
export function deriveStatus(rotulo?: string, pagina?: string): 'CORRETA' | 'INCORRETA' | null {
  const r = norm(rotulo), p = norm(pagina);
  if (!ROTULOS.includes(r) || !PAGINAS.includes(p)) return null;
  switch (r) {
    // seguranca (crime/polícia noticiados) sob categoria comum também é INCORRETA: a equipe marcou 5 de 5 na rodada 2
    // e o category_map já trata Policial/Segurança Pública como violência.
    case 'comum': return ['violencia', 'seguranca', 'adulto', 'estrangeiro', 'drogas'].includes(p) ? 'INCORRETA' : 'CORRETA';
    case 'restritivo': return ['violencia', 'seguranca', 'drogas'].includes(p) ? 'CORRETA' : 'INCORRETA';
    case 'adulto': return p === 'adulto' ? 'CORRETA' : 'INCORRETA';
    case 'estrangeiro': return p === 'estrangeiro' ? 'CORRETA' : 'INCORRETA';
    case 'tecnica': return p === 'tecnica' ? 'CORRETA' : 'INCORRETA';
    default: return 'INCORRETA'; // "home" em URL com caminho (a raiz é resolvida antes, sem IA)
  }
}
const SUGERIDA: Record<string, string> = { violencia: 'Violência e Criminalidade', seguranca: 'Segurança Pública', adulto: 'Conteúdo adulto', estrangeiro: 'Língua estrangeira', drogas: 'Drogas / Conteúdo sensível', comum: 'Notícias' };

// Regras de negócio comuns aos dois prompts (única fonte): o completo só acrescenta persona e exemplos.
function regrasComuns(categoriasDisponiveis: string[]): string {
  return `Regra principal: você audita se a CLASSIFICAÇÃO está certa, não se o conteúdo é bom. Se a categoria atribuída descreve fielmente o que a URL é, ela é CORRETA, mesmo sendo uma categoria indevida (ex.: um site de pornografia classificado como "Conteúdo adulto" está CORRETO). INCORRETA é quando a categoria não descreve a URL.

Regras:
- "safeframe", "aplicativo móvel" e "teste de tag" são falhas técnicas de rastreamento. Se a URL é de notícia, blog ou portal com conteúdo editorial, é INCORRETA (sugira a categoria real). Só é CORRETA se for um frame técnico sem conteúdo.
- "Home" = página raiz sem caminho (ex.: https://g1.globo.com/) → CORRETA. "Home" em URL com caminho interno → INCORRETA.
${FAMILIAS}
- Categorias indevidas: Língua estrangeira (conteúdo fora do português), Conteúdo adulto, Violência, Crimes, Terrorismo, Discurso de ódio, Conteúdo gerado pelo usuário sem moderação (fóruns/chats), Drogas.${categoriasDisponiveis.length > 0 ? `
- Categorias deste arquivo (prefira sugerir uma destas): ${categoriasDisponiveis.join(', ')}.` : ''}`;
}

export function buildFullPrompt(items: UrlSampleItem[], categoriasDisponiveis: string[]): string {
  const list = items.map((it, i) => `${i + 1}. ${it.url} | categoria atribuída: ${it.categoria}`).join('\n');
  return `Você é um classificador especialista em Brand Safety e auditoria de mídia programática para a SECOM (Secretaria de Comunicação Social do Governo Federal do Brasil).

Sua missão é auditar a classificação de conteúdo feita por um adserver. Dada uma URL e a categoria atribuída pelo adserver, avalie se a classificação está CORRETA ou INCORRETA. Julgue pela URL.

${regrasComuns(categoriasDisponiveis)}

### EXEMPLOS (entrada e resposta esperada)
1. https://g1.globo.com/politica/noticia/2026/06/governo-anuncia-novas-medidas-economicas.html | categoria atribuída: safeframe
2. https://exemplo.com.br/receitas/bolo-de-cenoura-com-cobertura-de-chocolate | categoria atribuída: Violência e Criminalidade
3. https://exemplo.com.br/noticias/homem-e-preso-apos-matar-a-companheira-a-facadas-em-casa | categoria atribuída: Notícias
4. https://exemplo.com.br/seguranca/governo-discute-reforma-do-sistema-prisional | categoria atribuída: Segurança Pública
5. https://exemplo.com.br/economia/imposto-de-renda-2026-erros-comuns | categoria atribuída: Esportes
[{"i":1,"pagina":"comum","status":"INCORRETA","categoria_sugerida":"Política / Economia","justificativa_brand_safety":"Notícia real classificada como categoria técnica."},
{"i":2,"pagina":"comum","status":"INCORRETA","categoria_sugerida":"Gastronomia","justificativa_brand_safety":"O rótulo de violência não descreve a página."},
{"i":3,"pagina":"violencia","status":"INCORRETA","categoria_sugerida":"Violência e Criminalidade","justificativa_brand_safety":"Feminicídio é conteúdo indevido mesmo sem imagem gráfica."},
{"i":4,"pagina":"seguranca","status":"CORRETA","categoria_sugerida":"","justificativa_brand_safety":""},
{"i":5,"pagina":"comum","status":"CORRETA","categoria_sugerida":"","justificativa_brand_safety":""}]

### AVALIE TODAS AS URLS ABAIXO
Responda APENAS com um array JSON, um objeto por URL, na mesma ordem, com "i" igual ao número da URL e os campos "pagina", "status", "categoria_sugerida" e "justificativa_brand_safety" como nos exemplos. Sem texto fora do array.

${list}`;
}

// Versão enxuta para o modelo local (CPU/GPU de 2 GB: cada token de prompt e de saída custa segundo).
// Um só formato de saída, sem few-shot, regras condensadas, justificativa de uma frase.
export function buildCompactPrompt(items: UrlSampleItem[], categoriasDisponiveis: string[]): string {
  const list = items.map((it, i) => `${i + 1}. ${it.url} | categoria atribuída: ${it.categoria}`).join('\n');
  return `Você audita a categoria que um adserver atribuiu a URLs (Brand Safety, SECOM / Governo Federal do Brasil). Julgue pela URL. Para cada uma, diga se a categoria atribuída está CORRETA ou INCORRETA.

${regrasComuns(categoriasDisponiveis)}

Responda SOMENTE com um array JSON, um objeto por URL, na ordem, sem texto fora do array.
INCORRETA: [{"i":1,"pagina":"violencia","status":"INCORRETA","categoria_sugerida":"categoria real","justificativa_brand_safety":"uma frase curta"}]
CORRETA (deixe os dois campos de texto vazios, não explique): [{"i":2,"pagina":"comum","status":"CORRETA","categoria_sugerida":"","justificativa_brand_safety":""}]

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

  let source = '';
  let parsed: { i?: number; pagina?: string; status?: string; categoria_sugerida?: string; justificativa_brand_safety?: string }[];
  try {
    const reply = await chatWithRetry(build, 220 * items.length, deadline);
    source = reply.source;
    const raw = reply.text
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
    const status = deriveStatus(rotuloFamily(item.categoria), entry?.pagina) ?? (entry?.status ?? '').trim().toUpperCase();
    if (!entry || (status !== 'CORRETA' && status !== 'INCORRETA')) { failed++; return; }
    rows.push({
      url: item.url,
      categoria: item.categoria,
      // O modelo às vezes devolve o próprio token da família ("violencia") como sugestão; troca pelo nome legível.
      categoria_sugerida: status === 'INCORRETA'
        ? (SUGERIDA[norm(entry.categoria_sugerida)] ?? (entry.categoria_sugerida?.trim() || SUGERIDA[norm(entry.pagina)] || null))
        : (entry.categoria_sugerida?.trim() || null),
      veiculo: item.veiculo,
      reason: entry.justificativa_brand_safety?.trim() || (status === 'CORRETA' ? '' : 'Classificação suspeita'),
      impressoes: item.impressoes,
      pct: 0,
      status,
      source,
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
