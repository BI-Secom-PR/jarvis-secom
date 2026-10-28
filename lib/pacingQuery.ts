import type { Pool } from 'mysql2/promise';
import { buildWhere, fromTable, withBuyingCampaigns, type DashboardFilters } from '@/lib/dashboard';
import { withCampaignNames } from '@/lib/campaignGroups';
import type { BudgetRow } from '@/lib/pacing';

const isoDay = (v: unknown): string | null =>
  v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

/**
 * Orçamentos (gold_campaign_budgets) com o gasto do gold, sob os filtros do dashboard.
 * O orçamento é do FLIGHT dele, não da janela: o gasto conta do início do flight até o
 * fim da janela (`to`), e a linha só entra se a campanha entregou na janela — senão as
 * 358 campanhas de LinkedIn (muitas de 2019) inflariam o total.
 */
export async function loadBudgetRows(pool: Pool, f: DashboardFilters): Promise<BudgetRow[]> {
  const T = fromTable('gold_platforms_campaigns', f);
  const fr = await withBuyingCampaigns(pool, await withCampaignNames(pool, f, T), T);
  // Sem `from` no gasto (o flight começa antes da janela); `to` limita até onde somar.
  const w = buildWhere({ ...fr, from: undefined });
  // Janela só para decidir se a linha entra (a campanha entregou nela).
  const win: string[] = [];
  const winParams: string[] = [];
  if (f.from) { win.push('g.date >= ?'); winParams.push(f.from); }
  if (f.to) { win.push('g.date <= ?'); winParams.push(f.to); }
  const inWin = win.length ? win.join(' AND ') : '1=1';

  // Com conjunto filtrado só vale orçamento de conjunto — o de campanha cobriria
  // também os conjuntos que o filtro tirou.
  const levelCond = f.adGroup?.length ? `AND b.level = 'ad_group'` : '';
  const [rows] = await pool.query(
    `SELECT b.id, b.platform, b.level, b.campaign_id, b.budget_total, b.budget_type,
            b.start_date, b.end_date,
            SUM(CASE WHEN (b.start_date IS NULL OR g.date >= b.start_date)
                      AND (b.end_date IS NULL OR g.date <= b.end_date) THEN g.cost ELSE 0 END) AS used,
            SUM(CASE WHEN ${inWin} AND (g.cost > 0 OR g.imp > 0) THEN 1 ELSE 0 END) AS in_window
       FROM gold_campaign_budgets b
       JOIN (SELECT platform, campaign_id, ad_group_id, date, SUM(cost) AS cost, SUM(impressions) AS imp
               FROM ${T}
              WHERE ${w.sql} AND campaign_id IN (SELECT campaign_id FROM gold_campaign_budgets WHERE active = 1)
              GROUP BY platform, campaign_id, ad_group_id, date) g
         ON g.platform = b.platform AND g.campaign_id = b.campaign_id
        AND (b.level = 'campaign' OR g.ad_group_id = b.ad_group_id)
      WHERE b.active = 1 ${levelCond}
      GROUP BY b.id
     HAVING in_window > 0`,
    [...winParams, ...w.params]
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    platform: String(r.platform),
    level: r.level === 'ad_group' ? 'ad_group' : 'campaign',
    campaignId: String(r.campaign_id),
    amount: Number(r.budget_total),
    daily: r.budget_type === 'daily',
    start: isoDay(r.start_date),
    end: isoDay(r.end_date),
    used: Number(r.used),
  }));
}

export type BudgetListRow = {
  id: number | null;
  platform: string;
  level: 'campaign' | 'ad_group';
  campaign_id: string;
  ad_group_id: string | null;
  /** Nome da campanha/conjunto; em linha sem orçamento é o nome vindo do gold. */
  name: string;
  budget_total: string | null;
  budget_type: 'lifetime' | 'daily';
  start_date: string | null;
  end_date: string | null;
  source_amount: string | null;
  source: 'auto' | 'manual' | null;
  updated_by: string | null;
  updated_at: string | null;
};

const LIST_LIMIT = 300;

/**
 * Linhas do modal de orçamentos para os filtros do dashboard: as campanhas que
 * entregaram na janela, cada uma com o orçamento que já existe — ou uma linha vazia
 * (`id: null`) para cadastrar. Plataformas sem origem (Kwai, YouTube) só aparecem
 * por aqui, senão não haveria onde digitar o valor.
 */
export async function loadBudgetList(pool: Pool, f: DashboardFilters): Promise<{ rows: BudgetListRow[]; truncated: boolean }> {
  const T = fromTable('gold_platforms_campaigns', f);
  const fr = await withBuyingCampaigns(pool, await withCampaignNames(pool, f, T), T);
  // Conjunto filtrado ou não, a lista é de campanhas; o conjunto só restringe as linhas de ad set.
  const w = buildWhere({ ...fr, adGroup: undefined });
  const [camps] = await pool.query(
    `SELECT platform, campaign_id, MAX(campaign_name) AS campaign_name
       FROM ${T} WHERE ${w.sql} AND campaign_id IS NOT NULL AND campaign_id <> ''
      GROUP BY platform, campaign_id HAVING SUM(cost) > 0 OR SUM(impressions) > 0
      ORDER BY platform, campaign_name LIMIT ${LIST_LIMIT + 1}`,
    w.params
  );
  const list = camps as { platform: string; campaign_id: string; campaign_name: string | null }[];
  const truncated = list.length > LIST_LIMIT;
  const campaigns = list.slice(0, LIST_LIMIT);
  if (!campaigns.length) return { rows: [], truncated };

  const [bs] = await pool.query(
    `SELECT id, platform, level, campaign_id, ad_group_id, name, budget_total, budget_type, start_date, end_date,
            source_amount, source, updated_by, updated_at
       FROM gold_campaign_budgets WHERE active = 1 AND campaign_id IN (?)`,
    [campaigns.map((c) => c.campaign_id)]
  );
  const byCampaign = new Map<string, Record<string, unknown>[]>();
  for (const b of bs as Record<string, unknown>[]) {
    const k = `${b.platform}|${b.campaign_id}`;
    byCampaign.set(k, [...(byCampaign.get(k) ?? []), b]);
  }

  const groups = f.adGroup?.length ? new Set(f.adGroup) : null;
  const toRow = (b: Record<string, unknown>): BudgetListRow => ({
    id: Number(b.id), platform: String(b.platform), level: b.level === 'ad_group' ? 'ad_group' : 'campaign',
    campaign_id: String(b.campaign_id), ad_group_id: b.ad_group_id == null ? null : String(b.ad_group_id),
    name: String(b.name ?? ''), budget_total: String(b.budget_total),
    budget_type: b.budget_type === 'daily' ? 'daily' : 'lifetime',
    start_date: isoDay(b.start_date), end_date: isoDay(b.end_date),
    source_amount: b.source_amount == null ? null : String(b.source_amount),
    source: b.source === 'manual' ? 'manual' : 'auto', updated_by: b.updated_by == null ? null : String(b.updated_by),
    updated_at: b.updated_at == null ? null : (b.updated_at instanceof Date ? b.updated_at.toISOString() : String(b.updated_at)),
  });

  // Conjunto filtrado: a lista é de conjuntos (um por ad_group_id que entregou), cada um com o
  // orçamento do próprio conjunto ou uma linha vazia de nível ad_group para cadastrar.
  if (groups) {
    const wg = buildWhere(fr);
    const [sets] = await pool.query(
      `SELECT platform, campaign_id, ad_group_id, MAX(ad_group_name) AS ad_group_name
         FROM ${T} WHERE ${wg.sql} AND campaign_id IS NOT NULL AND campaign_id <> ''
          AND ad_group_id IS NOT NULL AND ad_group_id <> ''
        GROUP BY platform, campaign_id, ad_group_id HAVING SUM(cost) > 0 OR SUM(impressions) > 0
        ORDER BY platform, ad_group_name LIMIT ${LIST_LIMIT + 1}`,
      wg.params
    );
    const gl = sets as { platform: string; campaign_id: string; ad_group_id: string; ad_group_name: string | null }[];
    const rowsG = gl.slice(0, LIST_LIMIT).map((g): BudgetListRow => {
      const have = (byCampaign.get(`${g.platform}|${g.campaign_id}`) ?? [])
        .find((b) => b.level === 'ad_group' && String(b.ad_group_id) === String(g.ad_group_id));
      return have ? toRow(have) : {
        id: null, platform: g.platform, level: 'ad_group', campaign_id: g.campaign_id, ad_group_id: g.ad_group_id,
        name: g.ad_group_name ?? g.ad_group_id, budget_total: null, budget_type: 'lifetime',
        start_date: null, end_date: null, source_amount: null, source: null, updated_by: null, updated_at: null,
      };
    });
    return { rows: rowsG, truncated: truncated || gl.length > LIST_LIMIT };
  }

  const rows: BudgetListRow[] = [];
  for (const c of campaigns) {
    const mine = byCampaign.get(`${c.platform}|${c.campaign_id}`) ?? [];
    const camp = mine.find((b) => b.level === 'campaign');
    const sets = mine.filter((b) => b.level === 'ad_group');
    if (camp) {
      rows.push(toRow(camp));
    } else if (sets.length) {
      rows.push(...sets.map(toRow)); // sem linha de campanha, são os conjuntos que valem
    } else {
      rows.push({
        id: null, platform: c.platform, level: 'campaign', campaign_id: c.campaign_id, ad_group_id: null,
        name: c.campaign_name ?? c.campaign_id, budget_total: null, budget_type: 'lifetime',
        start_date: null, end_date: null, source_amount: null, source: null, updated_by: null, updated_at: null,
      });
    }
  }
  return { rows, truncated };
}

/** Plataformas que entregaram no recorte — o card lista todas, com ou sem orçamento cadastrado. */
export async function loadDeliveringPlatforms(pool: Pool, f: DashboardFilters): Promise<string[]> {
  const T = fromTable('gold_platforms_campaigns', f);
  const fr = await withBuyingCampaigns(pool, await withCampaignNames(pool, f, T), T);
  const w = buildWhere(fr);
  const [rows] = await pool.query(
    `SELECT platform FROM ${T} WHERE ${w.sql} GROUP BY platform HAVING SUM(cost) > 0 OR SUM(impressions) > 0`,
    w.params
  );
  return (rows as { platform: string }[]).map((r) => r.platform);
}

export type DeliveredCampaign = { platform: string; campaignId: string; name: string; cost: number };

/** Campanhas reais que entregaram no recorte (o filtro agrupa várias numa só) e o gasto na janela. */
export async function loadDeliveredCampaigns(pool: Pool, f: DashboardFilters): Promise<DeliveredCampaign[]> {
  const T = fromTable('gold_platforms_campaigns', f);
  const fr = await withBuyingCampaigns(pool, await withCampaignNames(pool, f, T), T);
  const w = buildWhere(fr);
  const [rows] = await pool.query(
    `SELECT platform, campaign_id, MAX(campaign_name) AS campaign_name, SUM(cost) AS cost
       FROM ${T} WHERE ${w.sql} AND campaign_id IS NOT NULL AND campaign_id <> ''
      GROUP BY platform, campaign_id HAVING SUM(cost) > 0 OR SUM(impressions) > 0
      ORDER BY platform, campaign_name LIMIT ${LIST_LIMIT}`,
    w.params
  );
  return (rows as { platform: string; campaign_id: string; campaign_name: string | null; cost: unknown }[])
    .map((r) => ({ platform: r.platform, campaignId: String(r.campaign_id), name: r.campaign_name ?? String(r.campaign_id), cost: Number(r.cost) }));
}
