import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPool, isTransientDbError, resetPool } from '@/lib/mysql';
import {
  buildWhere, METRIC_SELECT, VIDEO_SELECT, AGE_BUCKET_SQL,
  UF_BY_NAME, HAS_DELIVERY, fromTable, platformLabel, GENDER_LABEL,
  type DashboardFilters,
} from '@/lib/dashboard';
import { withCampaignNames } from '@/lib/campaignGroups';
import {
  BASE_METRICS, bothCampaignAndAd, COMBINED_LABEL, DATASETS, EXPORT_COLUMNS,
  isColKey, isDataset, toSheetRow,
  type BaseMetric, type ColKey, type ExportDataset, type ExportRow,
} from '@/lib/dashboardExport';
import { generateXlsxSheets } from '@/lib/exports/xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ponytail: teto por aba em vez de paginação — 20 mil linhas cobrem qualquer recorte
// que alguém abra no Excel; se um dia estourar, sobe o número (ou vira streaming).
const EXPORT_LIMIT = 20_000;

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

/** Linha do MySQL → ExportRow, com as dimensões que o conjunto tiver. */
const rowOf = (r: Record<string, unknown>): ExportRow => ({
  platform: r.platform ? platformLabel(String(r.platform)) : '',
  campanha: String(r.campaign_name ?? ''),
  anuncio: String(r.ad_name ?? ''),
  faixa: String(r.faixa ?? ''),
  gender: r.gender ? GENDER_LABEL[String(r.gender)] ?? String(r.gender) : '',
  uf: r.region_name ? UF_BY_NAME[String(r.region_name)] ?? '' : '',
  estado: String(r.region_name ?? ''),
  cost: n(r.cost), impressions: n(r.impressions), reach: n(r.reach), clicks: n(r.clicks),
  video_views: n(r.video_views), engagement: n(r.engagement),
  likes: n(r.likes), comments: n(r.comments), shares: n(r.shares),
  reactions: n(r.reactions), saves: n(r.saves),
  p25: n(r.p25), p50: n(r.p50), p75: n(r.p75), p95: n(r.p95), p100: n(r.p100),
  completions: n(r.completions),
});

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
    tema: strs(body.tema),
  };

  const pool = getPool();
  const T_CAMP = fromTable('gold_platforms_campaigns', f);
  const T_AGE = fromTable('gold_platforms_age_gender', f);
  const T_REG = fromTable('gold_platforms_regions', f);

  // ── Sonda de campos ──────────────────────────────────────────────────────
  // O modal pergunta ANTES de exportar quais métricas têm algum valor no recorte,
  // e só oferece as colunas correspondentes: filtrar Pinterest não pode continuar
  // oferecendo Reações (só Facebook) nem quartis 95% (só Meta). Vem do próprio
  // recorte em vez de uma matriz plataforma×métrica no código — a do dicionário
  // já está defasada, e o dado responde por si.
  if (body.probe === true) {
    try {
      const w = buildWhere(await withCampaignNames(pool, f, T_CAMP));
      const [camp, demo, reg] = await Promise.all([
        pool.query(`SELECT ${METRIC_SELECT}, ${VIDEO_SELECT} FROM ${T_CAMP} WHERE ${w.sql}`, w.params),
        pool.query(`SELECT ${METRIC_SELECT} FROM ${T_AGE} WHERE ${w.sql}`, w.params),
        pool.query(`SELECT ${METRIC_SELECT} FROM ${T_REG} WHERE ${w.sql}`, w.params),
      ]);
      // As colunas do SELECT já são os nomes das métricas-base; sobra quem somou algo.
      const nonzero = (res: unknown) => {
        const row = ((res as [Record<string, unknown>[]])[0] ?? [])[0] ?? {};
        return Object.keys(row).filter((k) => n(row[k]) !== 0);
      };
      return NextResponse.json({
        fields: { campanhas: nonzero(camp), demografia: nonzero(demo), regiao: nonzero(reg) },
      });
    } catch (e) {
      console.error('[dashboard/export probe]', e);
      if (isTransientDbError(e)) resetPool();
      // Falha na sonda não pode travar o export: sem `fields` o modal oferece tudo.
      return NextResponse.json({ fields: null });
    }
  }

  // Conjuntos e colunas são whitelists do catálogo — nada do cliente vira SQL.
  const datasets = strs(body.datasets).filter(isDataset) as ExportDataset[];
  const picked = new Set(strs(body.columns).filter(isColKey) as ColKey[]);
  if (!datasets.length) return NextResponse.json({ error: 'Selecione ao menos um conjunto de dados' }, { status: 400 });
  // Colunas de uma aba, na ordem do catálogo: as marcadas que os conjuntos daquela
  // aba oferecem; se nada sobrou, o padrão deles.
  const CATALOG = Object.keys(EXPORT_COLUMNS) as ColKey[];
  const colsOf = (ds: ExportDataset[]): ColKey[] => {
    const offered = new Set(ds.flatMap((d) => DATASETS[d].cols));
    const cols = CATALOG.filter((c) => offered.has(c) && picked.has(c));
    return cols.length ? cols : CATALOG.filter((c) => ds.some((d) => DATASETS[d].default.includes(c)));
  };

  try {
    const w = buildWhere(await withCampaignNames(pool, f, T_CAMP));

    // Mesmas queries do dashboard (app/api/dashboard/data/route.ts), sem o LIMIT da tela.
    const SEL_CAMP = `${METRIC_SELECT}, ${VIDEO_SELECT}`;
    const campanhasSql = (dims: string) =>
      `SELECT ${dims}, ${SEL_CAMP} FROM ${T_CAMP} WHERE ${w.sql}
        GROUP BY ${dims} HAVING ${HAS_DELIVERY}
        ORDER BY SUM(cost) DESC LIMIT ${EXPORT_LIMIT}`;

    // Campanha e anúncio na MESMA aba quando os dois estão marcados: o grão passa a
    // ser o anúncio, com o nome da campanha na linha. Separá-los em duas abas obriga
    // a cruzar na mão o que esta query já cruza.
    const jobs: { title: string; sql: string; ds: ExportDataset[] }[] = [];
    if (bothCampaignAndAd(datasets)) {
      jobs.push({ title: COMBINED_LABEL, sql: campanhasSql('platform, campaign_name, ad_name'), ds: ['campanhas', 'anuncios'] });
    } else {
      if (datasets.includes('campanhas')) jobs.push({ title: DATASETS.campanhas.label, sql: campanhasSql('platform, campaign_name'), ds: ['campanhas'] });
      if (datasets.includes('anuncios')) jobs.push({ title: DATASETS.anuncios.label, sql: campanhasSql('platform, ad_name'), ds: ['anuncios'] });
    }
    if (datasets.includes('demografia')) jobs.push({
      title: DATASETS.demografia.label, ds: ['demografia'],
      sql: `SELECT ${AGE_BUCKET_SQL} AS faixa, gender, ${METRIC_SELECT}
              FROM ${T_AGE} WHERE ${w.sql}
             GROUP BY faixa, gender ORDER BY SUM(impressions) DESC LIMIT ${EXPORT_LIMIT}`,
    });
    if (datasets.includes('regiao')) jobs.push({
      title: DATASETS.regiao.label, ds: ['regiao'],
      sql: `SELECT region_name, ${METRIC_SELECT}
              FROM ${T_REG} WHERE ${w.sql}
             GROUP BY region_name ORDER BY SUM(impressions) DESC LIMIT ${EXPORT_LIMIT}`,
    });

    // Sequencial de propósito: o pool (limite 10) é o mesmo da rota de filtros,
    // que continua servindo a tela.
    const sheets: { title: string; rows: Record<string, unknown>[] }[] = [];
    for (const job of jobs) {
      const [res] = await pool.query(job.sql, w.params);
      const rows = (res as Record<string, unknown>[]).map(rowOf);
      // A poda por aba: o que a fonte desta aba não reporta sai daqui, mesmo que o
      // usuário tenha marcado por causa de outro conjunto (Meta tem visualização em
      // campanhas e zero em região — a aba Região não leva CPV/VTR).
      const has = new Set<BaseMetric>();
      for (const r of rows) for (const m of BASE_METRICS) if (r[m] !== 0) has.add(m);
      const cols = colsOf(job.ds).filter((c) => EXPORT_COLUMNS[c].requires.every((m) => has.has(m)));
      sheets.push({ title: job.title, rows: rows.map((r) => toSheetRow(r, cols)) });
    }

    const buffer = await generateXlsxSheets(sheets);
    const name = `Dashboard SECOM ${f.from ?? ''} a ${f.to ?? ''}`.trim().replace(/[^\w\- áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, '');
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(`${name}.xlsx`)}"`,
      },
    });
  } catch (e) {
    console.error('[dashboard/export]', e);
    if (isTransientDbError(e)) {
      resetPool();
      return NextResponse.json({ error: 'Conexão com o banco esgotou. Tente novamente.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Erro ao gerar o Excel' }, { status: 500 });
  }
}
