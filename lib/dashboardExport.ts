// Catálogo do EXPORT do dashboard: quais conjuntos existem, quais colunas cada um
// oferece e como cada coluna sai do agregado. Módulo puro (nada de server) porque o
// modal e a rota `/api/dashboard/export` leem daqui — rótulo, ordem e aritmética não
// podem divergir entre a tela e o arquivo.

import { ENGAGEMENT_PARTS, type EngagementPartKey } from './dashboard';

export type ExportDataset = 'campanhas' | 'anuncios' | 'demografia' | 'regiao';

/** Uma linha agregada, já normalizada pela rota. Dimensões que não existem no
 *  conjunto simplesmente vêm vazias — a coluna nem é oferecida. */
export type ExportRow = Record<EngagementPartKey, number> & {
  platform: string; campanha: string; anuncio: string;
  faixa: string; gender: string; uf: string; estado: string;
  cost: number; impressions: number; reach: number; clicks: number;
  video_views: number; engagement: number;
  p25: number; p50: number; p75: number; p95: number; p100: number; completions: number;
};

const div = (a: number, b: number) => (b ? a / b : 0);

/** Métricas somadas direto do banco — é sobre elas que a sonda decide o que existe
 *  no recorte (ver `availableColumns`). */
export type BaseMetric =
  | 'cost' | 'impressions' | 'reach' | 'clicks' | 'video_views' | 'engagement'
  | EngagementPartKey | 'p25' | 'p50' | 'p75' | 'p95' | 'p100' | 'completions';

export const BASE_METRICS: BaseMetric[] = [
  'cost', 'impressions', 'reach', 'clicks', 'video_views', 'engagement',
  ...ENGAGEMENT_PARTS.map((p) => p.key),
  'p25', 'p50', 'p75', 'p95', 'p100', 'completions',
];

/** `requires` = as métricas que precisam ter algum valor no recorte para a coluna
 *  fazer sentido. Dimensão não requer nada; derivada requer TODAS as suas entradas
 *  (um CPV cravado em zero porque a plataforma não reporta view é ruído, não dado). */
type ColDef = { label: string; value: (r: ExportRow) => string | number; requires: BaseMetric[] };

/** Espelha a tabela de Performance do dashboard, coluna por coluna. Valores crus —
 *  o Excel formata via numFmt; texto com "R$"/"%" viraria string e não somaria. */
export const EXPORT_COLUMNS = {
  // dimensões
  platform:   { label: 'Plataforma',    value: (r) => r.platform, requires: [] },
  campanha:   { label: 'Campanha',      value: (r) => r.campanha, requires: [] },
  anuncio:    { label: 'Anúncio',       value: (r) => r.anuncio,  requires: [] },
  faixa:      { label: 'Faixa etária',  value: (r) => r.faixa,    requires: [] },
  gender:     { label: 'Gênero',        value: (r) => r.gender,   requires: [] },
  uf:         { label: 'UF',            value: (r) => r.uf,       requires: [] },
  estado:     { label: 'Estado',        value: (r) => r.estado,   requires: [] },
  // métricas
  cost:       { label: 'Investimento',  value: (r) => r.cost,        requires: ['cost'] },
  impressions:{ label: 'Impressões',    value: (r) => r.impressions, requires: ['impressions'] },
  cpm:        { label: 'CPM',           value: (r) => div(r.cost, r.impressions) * 1000, requires: ['cost', 'impressions'] },
  reach:      { label: 'Alcance',       value: (r) => r.reach,       requires: ['reach'] },
  clicks:     { label: 'Cliques',       value: (r) => r.clicks,      requires: ['clicks'] },
  cpc:        { label: 'CPC',           value: (r) => div(r.cost, r.clicks),   requires: ['cost', 'clicks'] },
  ctr:        { label: 'CTR (%)',       value: (r) => div(r.clicks, r.impressions) * 100, requires: ['clicks', 'impressions'] },
  engagement: { label: 'Engajamento',   value: (r) => r.engagement,  requires: ['engagement'] },
  ...(Object.fromEntries(ENGAGEMENT_PARTS.map((p) => [
    p.key, { label: p.label, value: (r: ExportRow) => r[p.key], requires: [p.key] },
  ])) as Record<EngagementPartKey, ColDef>),
  cpe:        { label: 'CPE',           value: (r) => div(r.cost, r.engagement), requires: ['cost', 'engagement'] },
  tx_eng:     { label: 'Tx. Eng. (%)',  value: (r) => div(r.engagement, r.impressions) * 100, requires: ['engagement', 'impressions'] },
  video_views:{ label: 'Visualizações', value: (r) => r.video_views, requires: ['video_views'] },
  cpv:        { label: 'CPV',           value: (r) => div(r.cost, r.video_views), requires: ['cost', 'video_views'] },
  vtr:        { label: 'VTR (%)',       value: (r) => div(r.video_views, r.impressions) * 100, requires: ['video_views', 'impressions'] },
  // quartis: contagens, como no Oracle (zero = plataforma não reporta)
  p25:        { label: '25%',           value: (r) => r.p25,  requires: ['p25'] },
  p50:        { label: '50%',           value: (r) => r.p50,  requires: ['p50'] },
  p75:        { label: '75%',           value: (r) => r.p75,  requires: ['p75'] },
  p95:        { label: '95%',           value: (r) => r.p95,  requires: ['p95'] },
  p100:       { label: '100%',          value: (r) => r.p100, requires: ['p100'] },
  completions:{ label: 'Completa',      value: (r) => r.completions, requires: ['completions'] },
} satisfies Record<string, ColDef>;

export type ColKey = keyof typeof EXPORT_COLUMNS;

export const isColKey = (v: unknown): v is ColKey =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXPORT_COLUMNS, v);

const PARTS = ENGAGEMENT_PARTS.map((p) => p.key);
const METRICS: ColKey[] = [
  'cost', 'impressions', 'cpm', 'reach', 'clicks', 'cpc', 'ctr',
  'engagement', ...PARTS, 'cpe', 'tx_eng', 'video_views', 'cpv', 'vtr',
];
const QUARTIS: ColKey[] = ['p25', 'p50', 'p75', 'p95', 'p100', 'completions'];
/** O que vem marcado ao abrir o modal — o miolo que quase toda análise usa. */
const DEFAULT_METRICS: ColKey[] = ['cost', 'impressions', 'cpm', 'clicks', 'cpc', 'ctr', 'engagement'];

export const DATASETS: Record<ExportDataset, { label: string; cols: ColKey[]; default: ColKey[] }> = {
  campanhas: {
    label: 'Campanhas',
    cols: ['platform', 'campanha', ...METRICS, ...QUARTIS],
    default: ['platform', 'campanha', ...DEFAULT_METRICS],
  },
  anuncios: {
    label: 'Anúncios',
    cols: ['platform', 'anuncio', ...METRICS, ...QUARTIS],
    default: ['platform', 'anuncio', ...DEFAULT_METRICS],
  },
  // Demografia e região não carregam quartis: as queries dessas dimensões não leem
  // o bloco de vídeo (ver app/api/dashboard/data/route.ts).
  demografia: {
    label: 'Idade & Gênero',
    cols: ['faixa', 'gender', ...METRICS],
    default: ['faixa', 'gender', ...DEFAULT_METRICS],
  },
  regiao: {
    label: 'Região',
    cols: ['uf', 'estado', ...METRICS],
    default: ['uf', 'estado', ...DEFAULT_METRICS],
  },
};

export const isDataset = (v: unknown): v is ExportDataset =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DATASETS, v);

/** Campanhas + Anúncios marcados juntos saem numa aba só, uma linha por anúncio com
 *  o nome da campanha ao lado — duas abas obrigariam a cruzar na mão o que o banco
 *  já sabe cruzar. */
export const bothCampaignAndAd = (ds: ExportDataset[]) =>
  ds.includes('campanhas') && ds.includes('anuncios');
export const COMBINED_LABEL = 'Campanhas e Anúncios';

/** Qual tabela do gold cada conjunto lê — a sonda roda uma vez por fonte, não por conjunto. */
export const SOURCE_OF: Record<ExportDataset, 'campanhas' | 'demografia' | 'regiao'> = {
  campanhas: 'campanhas', anuncios: 'campanhas', demografia: 'demografia', regiao: 'regiao',
};

/** Resultado da sonda: por fonte, as métricas que têm algum valor no recorte. */
export type FieldProbe = Record<'campanhas' | 'demografia' | 'regiao', BaseMetric[]>;

/** Colunas que fazem sentido oferecer para este conjunto neste recorte: as que a
 *  plataforma filtrada de fato reporta. Sem sonda (ainda carregando), oferece tudo. */
export function availableColumns(d: ExportDataset, probe: FieldProbe | null): ColKey[] {
  if (!probe) return DATASETS[d].cols;
  const has = new Set(probe[SOURCE_OF[d]] ?? []);
  return DATASETS[d].cols.filter((c) => EXPORT_COLUMNS[c].requires.every((m) => has.has(m)));
}

/** Uma linha do agregado → o objeto que vira linha da planilha, na ordem do catálogo. */
export function toSheetRow(r: ExportRow, cols: ColKey[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const c of cols) out[EXPORT_COLUMNS[c].label] = EXPORT_COLUMNS[c].value(r);
  return out;
}
