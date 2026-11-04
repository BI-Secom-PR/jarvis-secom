// Recalcula os benchmarks do prompt (lib/agent.ts: "MÉDIAS DA SECOM" e "BENCHMARKS SECOM POR PLATAFORMA"):
//   npx tsx --env-file=.env.local scripts/benchmarks.ts [--until YYYY-MM-DD] [--min-imp N]
//
// Só lê o gold. Não edita o prompt: imprime os números e quem atualiza o texto é você.
// Método (o mesmo do prompt):
//   • razões SUM/SUM — nunca média de taxas diárias;
//   • CPV, VTR e VTRc só sobre linhas que reportam o dado (views>0 / p100>0 / completions>0),
//     porque zero = a plataforma não reporta, não é fracasso; CPM, CPC e CTR sobre todas;
//   • CPE = custo / (likes+comments+shares+reactions+saves) — nunca a coluna `engagements`;
//   • Kwai: video_views. LinkedIn: CPV e VTRc por video_completions, VTR(2s) por video_views;
//   • Amazon e LinkedIn: só linhas em BRL. Pinterest vem como 'USD' mas o valor já é BRL;
//   • faixas = P25–P75 do KPI por campanha, só campanhas com 1 Mi+ de impressões.

import { getPool } from '../lib/mysql';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const UNTIL = arg('until', new Date().toISOString().slice(0, 10));
const MIN_IMP = Number(arg('min-imp', '10000000'));
if (!/^\d{4}-\d{2}-\d{2}$/.test(UNTIL) || !Number.isFinite(MIN_IMP)) throw new Error('args inválidos');

const ENG = '(likes+comments+shares+reactions+saves)';
const WHERE = `date <= '${UNTIL}' AND (platform NOT IN ('amazon_dsp','linkedin') OR cost_currency='BRL')`;
// LinkedIn usa completions no CPV/VTRc; as demais usam views (CPV) e p100 (VTRc).
const CPV_N = `CASE WHEN platform='linkedin' THEN video_completions ELSE video_views END`;
const VTRC_N = `CASE WHEN platform='linkedin' THEN video_completions ELSE video_p100 END`;
const fix = (v: unknown, d: number) => (v == null ? '–' : Number(v).toFixed(d));

const quant = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const band = (a: number[], d: number) =>
  a.length < 5 ? '(n<5)' : `${quant(a, .25).toFixed(d)}–${quant(a, .75).toFixed(d)} (mediana ${quant(a, .5).toFixed(d)})`;

async function main() {
  const pool = getPool();

  const [medias] = await pool.query(`
    SELECT platform, COALESCE(objective,'(NULL)') objetivo, COUNT(DISTINCT campaign_name) campanhas, SUM(impressions) impressoes,
      SUM(cost)/NULLIF(SUM(impressions),0)*1000 cpm,
      SUM(cost)/NULLIF(SUM(clicks),0) cpc,
      SUM(clicks)/NULLIF(SUM(impressions),0)*100 ctr,
      SUM(CASE WHEN ${CPV_N}>0 THEN cost END)/NULLIF(SUM(${CPV_N}),0) cpv,
      SUM(video_views)/NULLIF(SUM(CASE WHEN video_views>0 THEN impressions END),0)*100 vtr,
      SUM(${VTRC_N})/NULLIF(SUM(CASE WHEN ${VTRC_N}>0 THEN impressions END),0)*100 vtrc,
      SUM(CASE WHEN ${ENG}>0 THEN cost END)/NULLIF(SUM(${ENG}),0) cpe
    FROM gold_campaigns_classified WHERE ${WHERE}
    GROUP BY platform, objective HAVING SUM(impressions) >= ${MIN_IMP}
    ORDER BY platform, impressoes DESC`);
  console.log(`\n## MÉDIAS por plataforma × objetivo — histórico até ${UNTIL}, objetivos com ${MIN_IMP.toLocaleString('pt-BR')}+ impressões`);
  console.table((medias as any[]).map(r => ({
    platform: r.platform, objetivo: r.objetivo, camp: r.campanhas, imp_mi: (Number(r.impressoes) / 1e6).toFixed(1),
    cpm: fix(r.cpm, 2), cpc: fix(r.cpc, 2), ctr: fix(r.ctr, 2), cpv: fix(r.cpv, 3), vtr: fix(r.vtr, 2), vtrc: fix(r.vtrc, 2), cpe: fix(r.cpe, 3),
  })));

  const [camps] = await pool.query(`
    SELECT platform, campaign_name, SUM(impressions) imp, SUM(cost) cost,
      SUM(CASE WHEN ${CPV_N}>0 THEN cost END) cost_v, SUM(${CPV_N}) v_n,
      SUM(CASE WHEN video_views>0 THEN impressions END) imp_views, SUM(video_views) views,
      SUM(CASE WHEN ${VTRC_N}>0 THEN impressions END) imp_c, SUM(${VTRC_N}) c_n
    FROM gold_campaigns_classified WHERE ${WHERE}
    GROUP BY platform, campaign_name HAVING SUM(impressions) >= 1000000`);
  const by: Record<string, any[]> = {};
  for (const r of camps as any[]) (by[r.platform] ||= []).push(r);
  const faixas = Object.entries(by).map(([platform, rs]) => {
    const withViews = rs.filter(r => Number(r.views) > 0 && Number(r.imp_views) >= 1e6);
    // CPV: mesmo piso de 1 Mi de impressões que o VTR, na base do próprio KPI (completions no LinkedIn, views nas demais).
    const withCpv = rs.filter(r => Number(r.v_n) > 0 && Number(r.cost_v) > 0 && Number(platform === 'linkedin' ? r.imp_c : r.imp_views) >= 1e6);
    const withC = rs.filter(r => Number(r.c_n) > 0 && Number(r.imp_c) >= 1e6);
    return {
      platform, campanhas: rs.length,
      cpm: band(rs.map(r => r.cost / r.imp * 1000), 2),
      cpv: band(withCpv.map(r => r.cost_v / r.v_n), 3),
      vtr: band(withViews.map(r => r.views / r.imp_views * 100), 1),
      vtrc: band(withC.map(r => r.c_n / r.imp_c * 100), 1),
    };
  });
  console.log('\n## FAIXAS (P25–P75 por campanha, 1 Mi+ de impressões)');
  console.table(faixas);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
