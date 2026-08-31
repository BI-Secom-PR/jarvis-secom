import type { Pool } from 'mysql2/promise';

// Shared pieces of the DASHBOARD: filter WHERE builder, the metric whitelist,
// age-bucket normalization and the region_name → UF map.
//
// Read-only over the gold layer. Every value the client sends is either bound
// as a parameter or looked up in a whitelist here — nothing is interpolated.

// Todo filtro de dimensão é multi-valor: N valores viram OR (`IN`) dentro do
// próprio filtro e AND entre filtros. Array vazio ou ausente = sem filtro.
export type DashboardFilters = {
  /** Inclusive date range over `date`, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Rótulos dos GRUPOS de campanha (ver lib/campaignGroups), não os nomes crus. */
  campaigns?: string[];
  /** Os `campaign_name` crus que os grupos cobrem — é o que vai para o WHERE. */
  campaignNames?: string[];
  platform?: string[];
  ad?: string[];
  objective?: string[];
  /** Tipos de compra escolhidos (CPM/CPC/CPV/CPE) — ver BUYING_TYPE_SQL. */
  buyingType?: string[];
  /** Os `campaign_id` que esses tipos cobrem — é o que vai para o WHERE. */
  buyingCampaignIds?: string[];
  /** Eixos temáticos do Framework v4 (códigos, ex. 'ECO'). Só existem nas views classificadas. */
  tema?: string[];
};

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parameterized WHERE shared by every dashboard query. */
export function buildWhere(f: DashboardFilters): { sql: string; params: unknown[] } {
  const conds: string[] = ['1=1'];
  const params: unknown[] = [];
  if (f.from && ISO_DATE.test(f.from)) { conds.push('date >= ?'); params.push(f.from); }
  if (f.to && ISO_DATE.test(f.to))     { conds.push('date <= ?'); params.push(f.to); }
  // mysql2 expande o array num único `?`, então `IN (?)` serve para 1 ou N valores.
  const inList = (col: string, vals?: string[]) => {
    if (vals?.length) { conds.push(`${col} IN (?)`); params.push(vals); }
  };
  // `campaigns` são rótulos de grupo; quem filtra é a lista de nomes crus que eles
  // cobrem. Aqui, e SÓ aqui, lista vazia significa "grupo sem nenhum nome na janela"
  // (rótulo obsoleto) e tem de zerar — `IN ()` é erro de sintaxe no MySQL, daí o 1=0.
  if (f.campaignNames) {
    if (f.campaignNames.length) { conds.push('campaign_name IN (?)'); params.push(f.campaignNames); }
    else conds.push('1=0');
  }
  // Tipo de compra também vira lista de ids resolvida (ver withBuyingCampaigns): o
  // CASE não pode ser aplicado por linha porque cada tabela guarda um vocabulário
  // diferente de `objective` para a mesma campanha. Vazio = nenhum id no tipo.
  if (f.buyingCampaignIds) {
    if (f.buyingCampaignIds.length) { conds.push('campaign_id IN (?)'); params.push(f.buyingCampaignIds); }
    else conds.push('1=0');
  }
  inList('platform', f.platform);
  inList('ad_name', f.ad);
  inList('objective', f.objective);
  inList('eixo', f.tema);
  return { sql: conds.join(' AND '), params };
}

// As views `*_classified` são supersets das tabelas-base (mesmas colunas + eixo/programa/…,
// sem JOIN). Conferido ao vivo em 2026-08-26: elas batem impressão por impressão com o fato
// em todo mês desde abril — o que está defasado é a COBERTURA de `eixo` (abr 84,6% · mai 97,2%
// · jun 93,9% · jul 46,9% · ago 0,0%), porque o job `creative_classifier` (repo mysql) parou.
// A troca é condicional ao filtro mesmo assim: sem tema o dashboard não ganha nada lendo a
// view, e assim nenhuma defasagem futura dela pode mexer nos totais gerais sem ninguém pedir.
const CLASSIFIED: Record<string, string> = {
  gold_platforms_campaigns:  'gold_campaigns_classified',
  gold_platforms_regions:    'gold_regions_classified',
  gold_platforms_age_gender: 'gold_age_gender_classified',
};

/** Tabela a consultar: a base, ou a view classificada quando há filtro de tema. */
export const fromTable = (base: string, f: DashboardFilters) =>
  f.tema?.length ? CLASSIFIED[base] ?? base : base;

/** The window of equal length immediately before [from, to], for the deltas. */
export function previousWindow(f: DashboardFilters): { from: string; to: string } | null {
  if (!f.from || !f.to || !ISO_DATE.test(f.from) || !ISO_DATE.test(f.to)) return null;
  const from = new Date(f.from + 'T00:00:00Z');
  const to = new Date(f.to + 'T00:00:00Z');
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(from.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

// ── Métricas ──────────────────────────────────────────────────────────────
// `engagements` is NOT usable: the platforms fill it with wildly different
// definitions (40,3 mi against 380 k of real interactions in the same window),
// so every engagement number here is the sum of the real actions instead.

/** Componentes reais do engajamento. A ordem é a da pilha e a das colunas.
 *  Cobertura desigual por plataforma: `reactions` só vem do Facebook e `saves`
 *  do Facebook + Pinterest, então boa parte dos filtros zera as duas — a UI
 *  esconde a parte que é zero na janela inteira. */
export const ENGAGEMENT_PARTS = [
  { key: 'likes',     label: 'Curtidas' },
  { key: 'comments',  label: 'Comentários' },
  { key: 'shares',    label: 'Compart.' },
  { key: 'reactions', label: 'Reações' },
  { key: 'saves',     label: 'Salvos' },
] as const;

export type EngagementPartKey = (typeof ENGAGEMENT_PARTS)[number]['key'];

// Derivado da lista para que o total e as partes não possam divergir.
export const REAL_ENGAGEMENT = `SUM(${ENGAGEMENT_PARTS.map((p) => p.key).join(' + ')})`;

export type MetricKey =
  | 'investimento' | 'impressoes' | 'alcance' | 'cliques' | 'visualizacoes' | 'engajamento' | 'ctr';

type MetricDef = { label: string; sql: string; kind: 'currency' | 'count' | 'pct' };

export const METRICS: Record<MetricKey, MetricDef> = {
  investimento:  { label: 'Investimento',  sql: 'SUM(cost)',          kind: 'currency' },
  impressoes:    { label: 'Impressões',    sql: 'SUM(impressions)',   kind: 'count' },
  alcance:       { label: 'Alcance',       sql: 'SUM(reach)',         kind: 'count' },
  cliques:       { label: 'Cliques',       sql: 'SUM(clicks)',        kind: 'count' },
  visualizacoes: { label: 'Visualizações', sql: 'SUM(video_views)',   kind: 'count' },
  engajamento:   { label: 'Engajamento',   sql: REAL_ENGAGEMENT,      kind: 'count' },
  ctr:           { label: 'CTR',           sql: 'SUM(clicks) / NULLIF(SUM(impressions), 0) * 100', kind: 'pct' },
};

export function isMetricKey(v: unknown): v is MetricKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(METRICS, v);
}

/** SELECT list every aggregate query shares. */
export const METRIC_SELECT = `
  SUM(cost)          AS cost,
  SUM(impressions)   AS impressions,
  SUM(reach)         AS reach,
  SUM(clicks)        AS clicks,
  SUM(video_views)   AS video_views,
  ${REAL_ENGAGEMENT} AS engagement,
  ${ENGAGEMENT_PARTS.map((p) => `SUM(${p.key}) AS ${p.key}`).join(',\n  ')}`;

/** Video quartiles — the block the Oracle table carries, as counts, not rates.
    Coverage is uneven: p25-p100 come from Meta, TikTok, GloboAds, Pinterest and
    Amazon; p95 only from Meta; `video_completions` only from Kwai and LinkedIn
    (Facebook uses p100 instead). A zero is "not reported", not "nobody watched". */
export const VIDEO_SELECT = `
  SUM(video_p25)         AS p25,
  SUM(video_p50)         AS p50,
  SUM(video_p75)         AS p75,
  SUM(video_p95)         AS p95,
  SUM(video_p100)        AS p100,
  SUM(video_completions) AS completions`;

// ── Faixas etárias ────────────────────────────────────────────────────────
// The gold table keeps each platform's native buckets, and they do not line up:
// Kwai reports "25 a 36" / "37 a 50" / "50+" and TikTok "55 a 100". Folding them
// onto the six standard bands is an approximation at the Kwai boundaries — the
// UI says so, rather than pretending the buckets are exact.
export const AGE_BUCKET_SQL = `CASE
  WHEN age IN ('13 a 17', '< 17')             THEN '13-17'
  WHEN age = '18 a 24'                        THEN '18-24'
  WHEN age IN ('25 a 34', '25 a 36')          THEN '25-34'
  WHEN age IN ('35 a 44', '37 a 50')          THEN '35-44'
  WHEN age = '45 a 54'                        THEN '45-54'
  WHEN age IN ('55 a 64', '55 a 100', '50+')  THEN '55+'
  ELSE 'n/d'
END`;

export const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+', 'n/d'] as const;
export const GENDERS = ['MULHER', 'HOMEM', 'DESCONHECIDO'] as const;
export const GENDER_LABEL: Record<string, string> = {
  MULHER: 'Mulher', HOMEM: 'Homem', DESCONHECIDO: 'Desconhecido',
};

// ── Regiões ───────────────────────────────────────────────────────────────
// ChartWidget's choropleth matches features by UF code, but the warehouse
// stores the state's full name. Anything not in this map (34 distinct values
// come back, so a few are noise or outside Brazil) is dropped from the map and
// grouped as "Outras" in the ranking.
export const UF_BY_NAME: Record<string, string> = {
  'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM', 'Bahia': 'BA',
  'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES', 'Goiás': 'GO',
  'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG',
  'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', 'Pernambuco': 'PE', 'Piauí': 'PI',
  'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS',
  'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC', 'São Paulo': 'SP',
  'Sergipe': 'SE', 'Tocantins': 'TO',
};

export const PLATFORM_LABEL: Record<string, string> = {
  meta: 'Meta', google: 'Google', tiktok: 'TikTok', kwai: 'Kwai',
  linkedin: 'LinkedIn', pinterest: 'Pinterest', amazon_dsp: 'Amazon DSP', globoads: 'GloboAds',
};
export const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p;

// `network` é a sub-rede dentro da plataforma: no Meta é o publisher_platform
// (facebook/instagram/…), no Google o network_type (YOUTUBE/SEARCH/…), e string
// vazia em todas as outras — conferido ao vivo em 2026-08-28.
export const NETWORK_LABEL: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', audience_network: 'Audience Network',
  messenger: 'Messenger', threads: 'Threads', unknown: 'n/d',
  YOUTUBE: 'YouTube', YOUTUBE_WATCH: 'YouTube', YOUTUBE_BUMPER: 'YouTube Bumper',
  SEARCH: 'Busca', SEARCH_PARTNERS: 'Parceiros de busca', DISPLAY: 'Display',
};
/** Plataforma sem sub-rede mostra um traço, não uma célula vazia. */
export const networkLabel = (n: string) => NETWORK_LABEL[n] ?? (n || '—');

// ── Granularidade da série temporal ───────────────────────────────────────
export type Granularity = 'dia' | 'semana' | 'mes';
export function isGranularity(v: unknown): v is Granularity {
  return v === 'dia' || v === 'semana' || v === 'mes';
}
/** Bucket expression + the label the client shows for it. */
export const GRAIN_SQL: Record<Granularity, string> = {
  dia: 'DATE(date)',
  semana: 'DATE(DATE_SUB(date, INTERVAL WEEKDAY(date) DAY))',
  mes: 'DATE(DATE_FORMAT(date, "%Y-%m-01"))',
};

/** Linhas sem entrega nenhuma (plataforma reportou a campanha, mas zerada)
    poluem as tabelas — o dashboard só mostra quem teve algum valor. */
export const HAS_DELIVERY = `cost > 0 OR impressions > 0 OR video_views > 0`;

// ── Tipo de compra ────────────────────────────────────────────────────────
// Não existe coluna no gold layer: é derivado do `objective`, com a mesma ordem
// do CASE do Oracle. O mapa é MAIOR que o de lá porque aqui o `objective` guarda
// o vocabulário cru de cada plataforma — o CASE original (ENGAGEMENT/AWARENESS/
// TRAFFIC/VIDEO…) deixava 72% das impressões sem tipo, já que os dois maiores
// valores da base são `TARGET_CPV` (Google) e `THRUPLAY` (Meta). Conferido ao vivo
// em 2026-08-31: com os termos abaixo sobram 2,3% sem tipo (DIGITAL/Audio/DAI do
// globoads e `objective` nulo).
export const BUYING_TYPE_SQL = `CASE
  WHEN UPPER(objective) REGEXP 'ENGAGEMENT|INCREASE FANS' THEN 'CPE'
  WHEN UPPER(objective) REGEXP 'AWARENESS|REACH|IMPRESSION|CPM' THEN 'CPM'
  WHEN UPPER(objective) REGEXP 'INTERACTION|TRAFFIC|CLICK|CONSIDERATION|VISIT|CONVERSION|LANDING_PAGE|CPA' THEN 'CPC'
  WHEN UPPER(objective) REGEXP 'VIDEO|THRUPLAY|CPV' THEN 'CPV'
  ELSE ''
END`;

/** Rótulo → `campaign_id[]`, como `withCampaignNames` faz com os grupos.
 *
 *  O tipo sai SEMPRE da tabela de campanhas e as outras abas filtram pelos ids que
 *  ele resolve. Aplicar o CASE por linha em cada tabela daria resposta diferente por
 *  aba: a mesma campanha do Meta é `THRUPLAY` em gold_platforms_campaigns e
 *  `OUTCOME_ENGAGEMENT` em gold_platforms_regions (3,3 bi de impressões trocando de
 *  CPV para CPE só de mudar de aba). Campanha com objetivos misturados entre os
 *  anúncios entra em mais de um tipo — inteira, é o preço de as abas concordarem. */
export async function withBuyingCampaigns<T extends DashboardFilters>(
  pool: Pool,
  f: T,
  table: string,
): Promise<T> {
  if (!f.buyingType?.length) return f;
  const w = buildWhere({ from: f.from, to: f.to });
  const [rows] = await pool.query(
    `SELECT DISTINCT campaign_id FROM ${table}
      WHERE ${w.sql} AND campaign_id IS NOT NULL AND (${HAS_DELIVERY})
        AND ${BUYING_TYPE_SQL} IN (?)`,
    [...w.params, f.buyingType]
  );
  return { ...f, buyingCampaignIds: (rows as { campaign_id: unknown }[]).map((r) => String(r.campaign_id)) };
}
