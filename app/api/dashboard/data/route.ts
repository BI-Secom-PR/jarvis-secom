import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool, isTransientDbError, resetPool } from '@/lib/mysql';
import {
  buildWhere, previousWindow, METRIC_SELECT, VIDEO_SELECT,
  AGE_BUCKET_SQL, GRAIN_SQL, isGranularity, UF_BY_NAME, HAS_DELIVERY,
  type DashboardFilters, type Granularity,
} from '@/lib/dashboard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TABLE_LIMIT = 50;

/** mysql2 hands DECIMAL/BIGINT back as strings — coerce once, at the edge. */
const n = (v: unknown): number => (v == null ? 0 : Number(v));

type Totals = { cost: number; impressions: number; reach: number; clicks: number; videoViews: number; engagement: number };
const totalsOf = (r: Record<string, unknown> | undefined): Totals => ({
  cost: n(r?.cost), impressions: n(r?.impressions), reach: n(r?.reach),
  clicks: n(r?.clicks), videoViews: n(r?.video_views), engagement: n(r?.engagement),
});

type Video = { p25: number; p50: number; p75: number; p95: number; p100: number; completions: number };
const videoOf = (r: Record<string, unknown>): Video => ({
  p25: n(r.p25), p50: n(r.p50), p75: n(r.p75), p95: n(r.p95), p100: n(r.p100), completions: n(r.completions),
});

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

  const f: DashboardFilters = {
    from: typeof body.from === 'string' ? body.from : undefined,
    to: typeof body.to === 'string' ? body.to : undefined,
    campaign: typeof body.campaign === 'string' && body.campaign ? body.campaign : undefined,
    platform: typeof body.platform === 'string' && body.platform ? body.platform : undefined,
    ad: typeof body.ad === 'string' && body.ad ? body.ad : undefined,
    objective: typeof body.objective === 'string' && body.objective ? body.objective : undefined,
  };
  const tab = body.tab === 'demografia' || body.tab === 'regiao' ? body.tab : 'campanhas';
  const gran: Granularity = isGranularity(body.gran) ? body.gran : 'dia';

  const w = buildWhere(f);
  const pool = getPool();

  try {
    if (tab === 'demografia') {
      // The crossed table is the only place age and gender coexist —
      // gold_platforms_age and _gender each collapse the other dimension.
      const [rows] = await pool.query(
        `SELECT ${AGE_BUCKET_SQL} AS faixa, gender, ${METRIC_SELECT}
           FROM gold_platforms_age_gender WHERE ${w.sql}
          GROUP BY faixa, gender`,
        w.params
      );
      return NextResponse.json({
        demografia: (rows as Record<string, unknown>[]).map((r) => ({
          faixa: String(r.faixa), gender: String(r.gender), ...totalsOf(r),
        })),
      });
    }

    if (tab === 'regiao') {
      const [rows] = await pool.query(
        `SELECT region_name, ${METRIC_SELECT}
           FROM gold_platforms_regions WHERE ${w.sql}
          GROUP BY region_name ORDER BY SUM(impressions) DESC`,
        w.params
      );
      return NextResponse.json({
        regioes: (rows as Record<string, unknown>[]).map((r) => ({
          estado: String(r.region_name ?? ''),
          uf: UF_BY_NAME[String(r.region_name ?? '')] ?? null,
          ...totalsOf(r),
        })),
      });
    }

    // ── Campanhas ────────────────────────────────────────────────────────
    const prev = previousWindow(f);
    const wPrev = prev ? buildWhere({ ...f, from: prev.from, to: prev.to }) : null;

    // Two waves so the pool never sees more than three of these at once
    // (connectionLimit is 10 and the filters route shares it).
    const [totalsRes, prevRes, dailyRes] = await Promise.all([
      pool.query(
        `SELECT ${METRIC_SELECT}, COUNT(DISTINCT CASE WHEN ${HAS_DELIVERY} THEN campaign_name END) AS campaigns,
                COUNT(DISTINCT CASE WHEN ${HAS_DELIVERY} THEN ad_id END) AS ads
           FROM gold_platforms_campaigns WHERE ${w.sql}`,
        w.params
      ),
      wPrev
        ? pool.query(`SELECT ${METRIC_SELECT} FROM gold_platforms_campaigns WHERE ${wPrev.sql}`, wPrev.params)
        : Promise.resolve([[]] as unknown as [Record<string, unknown>[]]),
      pool.query(
        `SELECT ${GRAIN_SQL[gran]} AS bucket, ${METRIC_SELECT}
           FROM gold_platforms_campaigns WHERE ${w.sql}
          GROUP BY bucket ORDER BY bucket`,
        w.params
      ),
    ]);

    const [campRes, adRes] = await Promise.all([
      pool.query(
        `SELECT platform, campaign_name, ${METRIC_SELECT}, ${VIDEO_SELECT}
           FROM gold_platforms_campaigns WHERE ${w.sql}
          GROUP BY platform, campaign_name HAVING ${HAS_DELIVERY}
          ORDER BY SUM(cost) DESC LIMIT ${TABLE_LIMIT}`,
        w.params
      ),
      pool.query(
        `SELECT platform, ad_name, ${METRIC_SELECT}, ${VIDEO_SELECT}
           FROM gold_platforms_campaigns WHERE ${w.sql}
          GROUP BY platform, ad_name HAVING ${HAS_DELIVERY}
          ORDER BY SUM(cost) DESC LIMIT ${TABLE_LIMIT}`,
        w.params
      ),
    ]);

    const totalsRow = (totalsRes[0] as Record<string, unknown>[])[0];
    const prevRow = (prevRes[0] as Record<string, unknown>[])[0];

    return NextResponse.json({
      totals: { ...totalsOf(totalsRow), campaigns: n(totalsRow?.campaigns), ads: n(totalsRow?.ads) },
      previous: prevRow ? totalsOf(prevRow) : null,
      daily: (dailyRes[0] as Record<string, unknown>[]).map((r) => ({ date: iso(r.bucket), ...totalsOf(r) })),
      campanhas: (campRes[0] as Record<string, unknown>[]).map((r) => ({
        platform: String(r.platform), nome: String(r.campaign_name ?? ''), ...totalsOf(r), ...videoOf(r),
      })),
      anuncios: (adRes[0] as Record<string, unknown>[]).map((r) => ({
        platform: String(r.platform), nome: String(r.ad_name ?? ''), ...totalsOf(r), ...videoOf(r),
      })),
      limit: TABLE_LIMIT,
    });
  } catch (e) {
    console.error('[dashboard/data]', e);
    if (isTransientDbError(e)) {
      resetPool();
      return NextResponse.json({ error: 'Conexão com o banco esgotou. Tente novamente.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Erro ao carregar o dashboard' }, { status: 500 });
  }
}
