// Agregação pura do pacing (sem banco) — a rota só traz as linhas.

export type BudgetRow = {
  platform: string;
  level: 'campaign' | 'ad_group';
  campaignId: string;
  amount: number;
  /** `true` = `amount` é por dia e o orçado do flight é amount × dias. */
  daily: boolean;
  start: string | null;
  end: string | null;
  /** Gasto do gold dentro do flight, até o fim da janela. */
  used: number;
};

export type PacingTotals = { total: number; used: number; left: number; pacing: number | null };
export type Pacing = PacingTotals & { byPlatform: (PacingTotals & { platform: string })[] };

const DAY = 86_400_000;

/** Orçado do flight: o valor vitalício, ou o diário × dias (sem datas não há como multiplicar). */
export function flightTotal(r: BudgetRow): number {
  if (!r.daily || !r.start || !r.end) return r.amount;
  const days = Math.round((Date.parse(r.end) - Date.parse(r.start)) / DAY) + 1;
  return r.amount * Math.max(days, 0);
}

const totalsOf = (total: number, used: number): PacingTotals => ({
  total, used, left: total - used, pacing: total > 0 ? used / total : null,
});

/**
 * Por campanha vale a linha de campanha; sem ela, somam-se os conjuntos — senão a
 * Meta/TikTok, que têm orçamento nos dois níveis, contariam em dobro.
 */
function keptRows(rows: BudgetRow[]): BudgetRow[] {
  const hasCampaign = new Set(rows.filter((r) => r.level === 'campaign').map((r) => `${r.platform}|${r.campaignId}`));
  return rows.filter((r) => r.level === 'campaign' || !hasCampaign.has(`${r.platform}|${r.campaignId}`));
}

/** Orçado/utilizado por campanha real (`plataforma|campaign_id`), com a mesma regra do total. */
export function pacingByCampaign(rows: BudgetRow[]): Map<string, { total: number; used: number }> {
  const out = new Map<string, { total: number; used: number }>();
  for (const r of keptRows(rows)) {
    const k = `${r.platform}|${r.campaignId}`;
    const cur = out.get(k) ?? { total: 0, used: 0 };
    cur.total += flightTotal(r); cur.used += r.used;
    out.set(k, cur);
  }
  return out;
}

export function aggregatePacing(rows: BudgetRow[]): Pacing {
  const kept = keptRows(rows);

  const per = new Map<string, { total: number; used: number }>();
  let total = 0, used = 0;
  for (const r of kept) {
    const t = flightTotal(r);
    total += t; used += r.used;
    const cur = per.get(r.platform) ?? { total: 0, used: 0 };
    cur.total += t; cur.used += r.used;
    per.set(r.platform, cur);
  }
  return {
    ...totalsOf(total, used),
    byPlatform: [...per].map(([platform, v]) => ({ platform, ...totalsOf(v.total, v.used) }))
      .sort((a, b) => b.total - a.total),
  };
}
