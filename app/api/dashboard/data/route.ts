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

const TOTAL_KEYS: (keyof Totals)[] =
  ['cost', 'impressions', 'reach', 'clicks', 'videoViews', 'engagement', ...ENGAGEMENT_PARTS.map((p) => p.key)];

/** Soma linhas que coincidem nas chaves dadas (as colunas de total são todas aditivas). */
function collapse<T extends Totals>(rows: T[], keys: (keyof T & string)[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    const k = keys.map((x) => String(r[x])).join('|');
    const cur = map.get(k);
    if (!cur) { map.set(k, { ...r }); continue; }
    for (const m of TOTAL_KEYS) cur[m] += r[m];
  }
  return [...map.values()];
}

/** Foco = exatamente uma campanha (grupo) ou, sem ela, exatamente uma plataforma. */
function focoDe(f: DashboardFilters): { foco: 'campanha' | 'plataforma'; nome: string } | null {
  if (f.campaigns?.length === 1) return { foco: 'campanha', nome: f.campaigns[0]! };
  if (f.platform?.length === 1) return { foco: 'plataforma', nome: f.platform[0]! };
  return null;
}

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
    // `network: true` é a quebra da tabela; o filtro viaja como `networks`.
    network: strs(body.networks),
    account: strs(body.account),
    ad: strs(body.ad),
    adGroup: strs(body.adGroup),
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
    // Região e idade/gênero só trazem `network` para o Google (Meta vem vazio, conferido
    // ao vivo em 2026-10-19): filtrar por rede ali zeraria a aba. O filtro vale em Campanhas.
    const wDim = buildWhere({ ...(await resolve(f)), network: undefined });

    if (tab === 'demografia' || tab === 'regiao') {
      // Leitura: as abas dimensionais comparam com a janela anterior e com o recorte sem o
      // foco, no mesmo WHERE sem rede (`wDim`). A quebra por plataforma só serve à leitura;
      // `demografia`/`regioes` seguem agregados como o gráfico e o export esperam.
      const prev = previousWindow(f);
      const dim = async (ff: DashboardFilters) => buildWhere({ ...(await resolve(ff)), network: undefined });
      const wPrevDim = prev ? await dim({ ...f, from: prev.from, to: prev.to }) : null;
      const focoDim = focoDe(f);
      const wRefDim = !focoDim ? null
        : await dim(focoDim.foco === 'campanha' ? { ...f, campaigns: [] } : { ...f, platform: [], network: [] });
      const none = Promise.resolve([[]] as unknown as [Record<string, unknown>[]]);
      const rowsOf = (res: [unknown, ...unknown[]]) => res[0] as Record<string, unknown>[];
      // Campanhas do recorte da aba (mesma tabela e WHERE): a leitura aponta quais têm tração.
      const campSql = (table: string, ww: { sql: string }) =>
        `SELECT platform, campaign_name, ${METRIC_SELECT} FROM ${table} WHERE ${ww.sql}
          GROUP BY platform, campaign_name HAVING ${HAS_DELIVERY}
          ORDER BY SUM(cost) DESC LIMIT ${TABLE_LIMIT}`;
      const campRows = (res: [unknown, ...unknown[]]) => rowsOf(res).map((r) => ({
        platform: String(r.platform), nome: String(r.campaign_name ?? ''), ...totalsOf(r),
      }));

      if (tab === 'demografia') {
        // The crossed table is the only place age and gender coexist —
        // gold_platforms_age and _gender each collapse the other dimension.
        const sql = (ww: { sql: string }) =>
          `SELECT platform, ${AGE_BUCKET_SQL} AS faixa, gender, ${METRIC_SELECT}
             FROM ${T_AGE} WHERE ${ww.sql}
            GROUP BY platform, faixa, gender`;
        // Público-alvo declarado no nome da campanha: só a view classificada o traz (a base
        // não tem), então esta consulta lê sempre a view — superset, mesmas linhas.
        const alvoSql = `SELECT target_age, target_gender, ${AGE_BUCKET_SQL} AS faixa, gender, ${METRIC_SELECT}
             FROM gold_age_gender_classified WHERE ${wDim.sql}
            GROUP BY target_age, target_gender, faixa, gender`;
        const [cur, prv, ref, alvo, camp] = await Promise.all([
          pool.query(sql(wDim), wDim.params),
          wPrevDim ? pool.query(sql(wPrevDim), wPrevDim.params) : none,
          wRefDim ? pool.query(sql(wRefDim), wRefDim.params) : none,
          pool.query(alvoSql, wDim.params),
          pool.query(campSql(T_AGE, wDim), wDim.params),
        ]);
        const demo = (res: [unknown, ...unknown[]]) => rowsOf(res).map((r) => ({
          platform: String(r.platform ?? ''), faixa: String(r.faixa), gender: String(r.gender), ...totalsOf(r),
        }));
        const porFaixaGenero = (rs: ReturnType<typeof demo>) => collapse(rs, ['faixa', 'gender']);
        const curRows = demo(cur);
        return NextResponse.json({
          demografia: porFaixaGenero(curRows).map(({ platform: _p, ...r }) => r),
          demografiaPlat: curRows,
          previousDemografia: wPrevDim ? porFaixaGenero(demo(prv)).map(({ platform: _p, ...r }) => r) : null,
          refDemografia: wRefDim ? porFaixaGenero(demo(ref)).map(({ platform: _p, ...r }) => r) : [],
          focoDim,
          campanhasDim: campRows(camp),
          alvo: rowsOf(alvo).map((r) => ({
            targetAge: r.target_age == null ? null : String(r.target_age),
            targetGender: r.target_gender == null ? null : String(r.target_gender),
            faixa: String(r.faixa), gender: String(r.gender), ...totalsOf(r),
          })),
        });
      }

      const sql = (ww: { sql: string }) =>
        `SELECT platform, region_name, ${METRIC_SELECT}
           FROM ${T_REG} WHERE ${ww.sql}
          GROUP BY region_name, platform`;
      const [cur, prv, ref, camp] = await Promise.all([
        pool.query(sql(wDim), wDim.params),
        wPrevDim ? pool.query(sql(wPrevDim), wPrevDim.params) : none,
        wRefDim ? pool.query(sql(wRefDim), wRefDim.params) : none,
        pool.query(campSql(T_REG, wDim), wDim.params),
      ]);
      const reg = (res: [unknown, ...unknown[]]) => rowsOf(res).map((r) => ({
        platform: String(r.platform ?? ''),
        estado: String(r.region_name ?? ''),
        uf: UF_BY_NAME[String(r.region_name ?? '')] ?? null,
        ...totalsOf(r),
      }));
      const porEstado = (rs: ReturnType<typeof reg>) =>
        collapse(rs, ['estado']).map(({ platform: _p, ...r }) => r).sort((a, b) => b.impressions - a.impressions);
      const curRows = reg(cur);
      return NextResponse.json({
        regioes: porEstado(curRows),
        regioesPlat: curRows,
        previousRegioes: wPrevDim ? porEstado(reg(prv)) : null,
        refRegioes: wRefDim ? porEstado(reg(ref)) : [],
        focoDim,
        campanhasDim: campRows(camp),
      });
    }

    // ── Campanhas ────────────────────────────────────────────────────────
    const prev = previousWindow(f);
    // A janela anterior resolve grupo e tipo de novo, na SUA janela: os nomes/ids que
    // eles cobrem mudam de mês para mês (PI e ID novos), e sem re-resolver o delta
    // compararia "campanha X" com "tudo".
    const wPrev = prev ? buildWhere(await resolve({ ...f, from: prev.from, to: prev.to })) : null;

    // Three waves so the pool never sees more than three of these at once
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

    // Leitura: plataforma × rede agora e na janela anterior, e a referência do foco.
    // Foco = exatamente uma campanha (grupo) ou, sem ela, exatamente uma plataforma; a
    // referência é o mesmo recorte sem esse filtro (o cliente subtrai o foco → "demais").
    const foco = f.campaigns?.length === 1 ? 'campanha' : f.platform?.length === 1 ? 'plataforma' : null;
    const wRef = foco === 'campanha'
      ? buildWhere(await resolve({ ...f, campaigns: [] }))
      : foco === 'plataforma'
        ? buildWhere(await resolve({ ...f, platform: [], network: [] }))
        : null;
    const redeSql = (ww: { sql: string }) =>
      `SELECT platform, network, ${METRIC_SELECT} FROM ${T_CAMP} WHERE ${ww.sql}
        GROUP BY platform, network HAVING ${HAS_DELIVERY}`;
    const none = Promise.resolve([[]] as unknown as [Record<string, unknown>[]]);
    const [redeRes, prevRedeRes, refRes] = await Promise.all([
      pool.query(redeSql(w), w.params),
      wPrev ? pool.query(redeSql(wPrev), wPrev.params) : none,
      wRef
        ? pool.query(`SELECT platform, ${METRIC_SELECT} FROM ${T_CAMP} WHERE ${wRef.sql} GROUP BY platform`, wRef.params)
        : none,
    ]);
    const redeRows = (res: [unknown, ...unknown[]]) => (res[0] as Record<string, unknown>[]).map((r) => ({
      platform: String(r.platform), network: String(r.network ?? ''), ...totalsOf(r),
    }));
    const previousByRede = redeRows(prevRedeRes);
    // Plataforma = soma das suas redes (as linhas particionam a janela).
    const previousByPlatform = [...new Set(previousByRede.map((r) => r.platform))].map((platform) => {
      const rs = previousByRede.filter((r) => r.platform === platform);
      const keys = Object.keys(rs[0]!).filter((k) => k !== 'platform' && k !== 'network') as (keyof Totals)[];
      return { platform, ...Object.fromEntries(keys.map((k) => [k, rs.reduce((acc, r) => acc + r[k], 0)])) };
    });

    const totalsRow = (totalsRes[0] as Record<string, unknown>[])[0];
    const prevRow = (prevRes[0] as Record<string, unknown>[])[0];

    return NextResponse.json({
      totals: { ...totalsOf(totalsRow), campaigns: n(totalsRow?.campaigns), ads: n(totalsRow?.ads) },
      previous: prevRow ? totalsOf(prevRow) : null,
      previousByPlatform,
      redes: redeRows(redeRes),
      previousByRede,
      referencia: foco && wRef ? {
        foco,
        nome: foco === 'campanha' ? f.campaigns![0] : f.platform![0],
        porPlataforma: (refRes[0] as Record<string, unknown>[]).map((r) => ({ platform: String(r.platform), ...totalsOf(r) })),
      } : null,
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
