import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool, isTransientDbError, resetPool } from '@/lib/mysql';
import { ISO_DATE, type DashboardFilters } from '@/lib/dashboard';
import { aggregatePacing } from '@/lib/pacing';
import { loadBudgetRows, loadDeliveringPlatforms } from '@/lib/pacingQuery';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

/**
 * Pacing = orçamento (gold_campaign_budgets) × gasto do gold, com os filtros do
 * dashboard. O orçamento é do FLIGHT dele, não da janela: o gasto conta do início do
 * flight até o fim da janela (`to`), e a linha só entra se a campanha entregou na
 * janela — senão as 358 campanhas de LinkedIn (muitas de 2019) inflariam o total.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

  const from = typeof body.from === 'string' && ISO_DATE.test(body.from) ? body.from : undefined;
  const to = typeof body.to === 'string' && ISO_DATE.test(body.to) ? body.to : undefined;
  const f: DashboardFilters = {
    from, to,
    campaigns: strs(body.campaign),
    platform: strs(body.platform),
    network: strs(body.networks),
    account: strs(body.account),
    // Orçamento não existe por anúncio, então `ad` não entra no pacing.
    adGroup: strs(body.adGroup),
    objective: strs(body.objective),
    buyingType: strs(body.buyingType),
    tema: strs(body.tema),
  };

  const pool = getPool();
  try {
    const [rows, delivering] = await Promise.all([loadBudgetRows(pool, f), loadDeliveringPlatforms(pool, f)]);
    const pacing = aggregatePacing(rows);
    const withBudget = new Set(pacing.byPlatform.map((p) => p.platform));
    return NextResponse.json({ ...pacing, noBudget: delivering.filter((p) => !withBudget.has(p)).sort() });
  } catch (e) {
    console.error('[dashboard/pacing]', e);
    if (isTransientDbError(e)) {
      resetPool();
      return NextResponse.json({ error: 'Conexão com o banco esgotou. Tente novamente.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Erro ao carregar o pacing' }, { status: 500 });
  }
}
