// Grupos de campanha do DASHBOARD — porte do CASE gigante da tela do Oracle.
//
// O warehouse guarda o nome cru, na convenção `ANO | CAMPANHA | OBJETIVO | AGÊNCIA | PI …`:
//   "2026 | AÇÕES DE OPORTUNIDADE - ALWAYS ON 6 | ALWAYS ON COMP. 20260015 | ENGAJAMENTO | CALIA"
// São 584 nomes distintos — dropdown impraticável. As regras abaixo dobram isso em ~30
// rótulos de negócio. Elas vivem no Postgres (`app_settings`), editáveis pelo modal do
// dashboard; o código só carrega o texto e aplica.
//
// `parseRules`/`groupOf` são puros; só `loadCampaignRules` toca no Postgres, e por
// import dinâmico — assim o check de scripts/test-campaign-groups.ts roda sem PG_* no
// ambiente. Ainda assim é server-only: nenhum componente cliente importa este arquivo.

import type { Pool } from 'mysql2/promise';
import { ISO_DATE, type DashboardFilters } from '@/lib/dashboard';

export const RULES_KEY = 'campaign_group_rules';

/** Transcrição do CASE do Oracle, na mesma ordem — a ordem É a semântica. */
export const DEFAULT_RULES = `# Uma regra por linha:  TERMO [+ TERMO] => Rótulo
# "+" = E. Para OU, repita o mesmo rótulo em outra linha. Vence a PRIMEIRA que casar.
# O match ignora maiúsculas e acentos ("AÇÕES" acha "ACOES", que existe no dado).
# Sem regra que case, o rótulo é o trecho entre o 1º e o 2º "|" do nome cru.

POSICIONAMENTO DE GOVERNO => Posicionamento do Governo do Brasil
POSICIONAMENTO - CONECTANDO => Posicionamento do Governo do Brasil
POSICIONAMENTO DO GOVERNO DO BRASIL => Posicionamento do Governo do Brasil
POSICIONAMENTO BAHIA => Posicionamento BA

TRABALHO PELO BRASIL + SANTA CATARINA => Trabalho pelo Brasil Santa Catarina
TRABALHO PELO BRASIL + AMAZONAS => Trabalho pelo Brasil Amazonas
TRABALHO PELO BRASIL + ESPIRITO => Trabalho pelo Brasil Espírito Santo
TRABALHO PELO BRASIL + RIO GRANDE => Trabalho pelo Rio Grande do Sul
TRABALHO PELO BRASIL + RONDONIA => Trabalho pelo Brasil Rondônia
TRABALHO PELO BRASIL + RORAIMA => Trabalho pelo Brasil Roraima

AÇÕES + OPORTUNIDADE => Always On
ALWAYS + IR => Always On IR
ALWAYS => Always On

PE_DE_MEIA => Pé de Meia
`;

export type Rule = { terms: string[]; label: string };

/** Maiúsculas + NFD sem diacrítico — o UPPER() do Oracle não bastava: o dado tem
    "AÇÕES DE OPORTUNIDADE" e "AÇOES DE OPORTUNIDADE" na mesma janela. */
const norm = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();

export function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=>');
    if (at < 0) continue; // linha malformada é ignorada, não derruba as outras
    const terms = line.slice(0, at).split('+').map((t) => norm(t.trim())).filter(Boolean);
    const label = line.slice(at + 2).trim();
    if (terms.length && label) rules.push({ terms, label });
  }
  return rules;
}

/** ELSE do Oracle: o trecho entre o 1º e o 2º "|". Sem dois pipes, o nome cru. */
function secondSegment(name: string): string {
  const parts = name.split('|');
  return parts.length >= 3 ? parts[1].trim() : name.trim();
}

export function groupOf(name: string, rules: Rule[]): string {
  const hay = norm(name);
  for (const r of rules) if (r.terms.every((t) => hay.includes(t))) return r.label;
  return secondSegment(name);
}

// ── Carga das regras ──────────────────────────────────────────────────────
// TTL curto porque na Vercel cada lambda tem seu processo: é o que faz um PUT
// aparecer nas outras instâncias sem invalidação distribuída.
const RULES_TTL_MS = 60 * 1000;
let cached: { text: string; rules: Rule[]; loadedAt: number } | null = null;

export async function loadCampaignRules(): Promise<{ text: string; rules: Rule[] }> {
  if (cached && Date.now() - cached.loadedAt < RULES_TTL_MS) return cached;
  let text = DEFAULT_RULES;
  try {
    const [{ db }, { appSettings }, { eq }] = await Promise.all([
      import('@/lib/db'), import('@/lib/db/schema'), import('drizzle-orm'),
    ]);
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, RULES_KEY)).limit(1);
    if (row) text = row.value;
  } catch (e) {
    // Falha de PG não pode derrubar o dashboard, que é todo MySQL: cai no default.
    console.error('[campaignGroups] falha ao ler as regras, usando o default', e);
  }
  cached = { text, rules: parseRules(text), loadedAt: Date.now() };
  return cached;
}

/** Chamado pelo PUT das regras — sem isto o admin espera até 60 s pra ver o efeito. */
export function invalidateCampaignRules(): void {
  cached = null;
  membersCache.clear();
}

/** Assinatura barata das regras, para entrar nas chaves de cache das rotas. */
export const rulesHash = (text: string): string => `${text.length}:${hash32(text)}`;
function hash32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

// ── Rótulos → nomes crus ──────────────────────────────────────────────────
// O filtro chega como rótulo(s) de grupo; o WHERE precisa dos campaign_name que
// eles cobrem. Um DISTINCT só com a janela de datas (sem os outros filtros — o
// conjunto de nomes de um grupo não depende de plataforma/objetivo) e o
// agrupamento em TS. N rótulos custam a mesma varredura: só a checagem muda.
const MEMBERS_TTL_MS = 10 * 60 * 1000;
const membersCache = new Map<string, { names: string[]; loadedAt: number }>();

export async function resolveGroups(
  pool: Pool,
  f: Pick<DashboardFilters, 'from' | 'to'>,
  labels: string[],
  table = 'gold_platforms_campaigns',
): Promise<string[]> {
  const { text, rules } = await loadCampaignRules();
  // Ordena para que a mesma seleção em outra ordem reaproveite o cache.
  const wanted = new Set(labels);
  const key = `${table}|${f.from ?? ''}|${f.to ?? ''}|${rulesHash(text)}|${[...wanted].sort().join('\u0000')}`;
  const hit = membersCache.get(key);
  if (hit && Date.now() - hit.loadedAt < MEMBERS_TTL_MS) return hit.names;

  const conds: string[] = ['1=1'];
  const params: unknown[] = [];
  if (f.from && ISO_DATE.test(f.from)) { conds.push('date >= ?'); params.push(f.from); }
  if (f.to && ISO_DATE.test(f.to)) { conds.push('date <= ?'); params.push(f.to); }
  const [rows] = await pool.query(
    `SELECT DISTINCT campaign_name FROM ${table}
      WHERE ${conds.join(' AND ')} AND campaign_name IS NOT NULL AND campaign_name != ''`,
    params,
  );
  const names = (rows as { campaign_name: string }[])
    .map((r) => r.campaign_name)
    .filter((n) => wanted.has(groupOf(n, rules)));

  if (membersCache.size > 200) membersCache.clear(); // ponytail: corte cru, LRU se um dia doer
  membersCache.set(key, { names, loadedAt: Date.now() });
  return names;
}

/** Aplica os grupos aos filtros: `campaigns` (rótulos) → `campaignNames` (nomes crus). */
export async function withCampaignNames<T extends DashboardFilters>(
  pool: Pool,
  f: T,
  table?: string,
): Promise<T> {
  if (!f.campaigns?.length) return f;
  return { ...f, campaignNames: await resolveGroups(pool, f, f.campaigns, table) };
}
