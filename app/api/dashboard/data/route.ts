import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool, isTransientDbError, resetPool } from '@/lib/mysql';
import {
  buildWhere, previousWindow, METRIC_SELECT, VIDEO_SELECT,
  AGE_BUCKET_SQL, GRAIN_SQL, isGranularity, UF_BY_NAME, HAS_DELIVERY, fromTable,
  ENGAGEMENT_PARTS, withBuyingCampaigns,
  type DashboardFilters, type Granularity, type EngagementPartKey,
} from '@/lib/dashboard';
import { withCampaignNames } from '@/lib/campaignGroups';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TABLE_LIMIT = 50;

/** mysql2 hands DECIMAL/BIGINT back as strings — coerce once, at the edge. */
const n = (v: unknown): number => (v == null ? 0 : Number(v));

/** Todo filtro de dimensão chega como lista de strings; nada além disso entra. */
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

type Totals = { cost: number; impressions: number; reach: number; clicks: number; videoViews: number; engagement: number }
  & Record<EngagementPartKey, number>;
const totalsOf = (r: Record<string, unknown> | undefined): Totals => ({
  cost: n(r?.cost), impressions: n(r?.impressions), reach: n(r?.reach),
  clicks: n(r?.clicks), videoViews: n(r?.video_views), engagement: n(r?.engagement),
  ...(Object.fromEntries(ENGAGEMENT_PARTS.map((p) => [p.key, n(r?.[p.key])])) as Record<EngagementPartKey, number>),
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
    campaigns: strs(body.campaign),
    platform: strs(body.platform),
    ad: strs(body.ad),
    objective: strs(body.objective),
    buyingType: strs(body.buyingType),
    tema: strs(body.tema),
  };
  const tab = body.tab === 'demografia' || body.tab === 'regiao' ? body.tab : 'campanhas';
  const gran: Granularity = isGranularity(body.gran) ? body.gran : 'dia';
  // Quebra a tabela por sub-rede (Meta → facebook/instagram, Google → YOUTUBE/SEARCH).
  const byNetwork = body.network === true;

  const pool = getPool();
  // Só troca de tabela quando há tema selecionado (ver fromTable em lib/dashboard).
  const T_CAMP = fromTable('gold_platforms_campaigns', f);
  const T_AGE = fromTable('gold_platforms_age_gender', f);
  const T_REG = fromTable('gold_platforms_regions', f);

  try {
    // `campaign` chega como rótulo(s) de grupo (ver lib/campaignGroups) e `buyingType`
    // como tipo de compra; o WHERE precisa dos campaign_name/campaign_id crus que eles
    // cobrem. Resolvidos sempre pela tabela de campanhas, que é onde os nomes vivem e
    // onde o tipo de compra é canônico — as de região/demografia repetem os mesmos.
    const resolve = async (ff: DashboardFilters) =>
      withBuyingCampaigns(pool, await withCampaignNames(pool, ff, T_CAMP), T_CAMP);
    const w = buildWhere(await resolve(f));

    if (tab === 'demografia') {
      // The crossed table is the only place age and gender coexist —
      // gold_platforms_age and _gender each collapse the other dimension.
      const [rows] = await pool.query(
        `SELECT ${AGE_BUCKET_SQL} AS faixa, gender, ${METRIC_SELECT}
           FROM ${T_AGE} WHERE ${w.sql}
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
           FROM ${T_REG} WHERE ${w.sql}
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
    // A janela anterior resolve grupo e tipo de novo, na SUA janela: os nomes/ids que
    // eles cobrem mudam de mês para mês (PI e ID novos), e sem re-resolver o delta
    // compararia "campanha X" com "tudo".
    const wPrev = prev ? buildWhere(await resolve({ ...f, from: prev.from, to: prev.to })) : null;

    // Two waves so the pool never sees more than three of these at once
    // (connectionLimit is 10 and the filters route shares it).
    const [totalsRes, prevRes, dailyRes] = await Promise.all([
      pool.query(
        `SELECT ${METRIC_SELECT}, COUNT(DISTINCT CASE WHEN ${HAS_DELIVERY} THEN campaign_name END) AS campaigns,
                COUNT(DISTINCT CASE WHEN ${HAS_DELIVERY} THEN ad_id END) AS ads
           FROM ${T_CAMP} WHERE ${w.sql}`,
        w.params
      ),
      wPrev
        ? pool.query(`SELECT ${METRIC_SELECT} FROM ${T_CAMP} WHERE ${wPrev.sql}`, wPrev.params)
        : Promise.resolve([[]] as unknown as [Record<string, unknown>[]]),
      pool.query(
        `SELECT ${GRAIN_SQL[gran]} AS bucket, ${METRIC_SELECT}
           FROM ${T_CAMP} WHERE ${w.sql}
          GROUP BY bucket ORDER BY bucket`,
        w.params
      ),
    ]);

    // Com a rede ligada, cada linha da tabela se divide pelas sub-redes daquela
    // plataforma; sem ela, `network` some do SELECT e do GROUP BY.
    const net = byNetwork ? 'network, ' : '';
    const tableSql = (dim: string) =>
      `SELECT ${net}platform, ${dim}, ${METRIC_SELECT}, ${VIDEO_SELECT}
         FROM ${T_CAMP} WHERE ${w.sql}
        GROUP BY ${net}platform, ${dim} HAVING ${HAS_DELIVERY}
        ORDER BY SUM(cost) DESC LIMIT ${TABLE_LIMIT}`;
    const [campRes, adRes] = await Promise.all([
      pool.query(tableSql('campaign_name'), w.params),
      pool.query(tableSql('ad_name'), w.params),
    ]);

    const totalsRow = (totalsRes[0] as Record<string, unknown>[])[0];
    const prevRow = (prevRes[0] as Record<string, unknown>[])[0];

    return NextResponse.json({
      totals: { ...totalsOf(totalsRow), campaigns: n(totalsRow?.campaigns), ads: n(totalsRow?.ads) },
      previous: prevRow ? totalsOf(prevRow) : null,
      daily: (dailyRes[0] as Record<string, unknown>[]).map((r) => ({ date: iso(r.bucket), ...totalsOf(r) })),
      campanhas: (campRes[0] as Record<string, unknown>[]).map((r) => ({
        platform: String(r.platform), network: String(r.network ?? ''),
        nome: String(r.campaign_name ?? ''), ...totalsOf(r), ...videoOf(r),
      })),
      anuncios: (adRes[0] as Record<string, unknown>[]).map((r) => ({
        platform: String(r.platform), network: String(r.network ?? ''),
        nome: String(r.ad_name ?? ''), ...totalsOf(r), ...videoOf(r),
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
