// Check ao vivo (só leitura) do pacing contra o MySQL:
//   npx tsx --env-file=.env.local scripts/test-pacing-live.ts
import assert from 'node:assert/strict';
import { getPool } from '../lib/mysql';
import { aggregatePacing } from '../lib/pacing';
import { loadBudgetRows } from '../lib/pacingQuery';

const FROM = '2026-10-01';
const TO = '2026-10-28';

(async () => {
  const pool = getPool();
  const all = await loadBudgetRows(pool, { from: FROM, to: TO });
  const p = aggregatePacing(all);
  console.log('sem filtro:', { rows: all.length, total: p.total.toFixed(2), used: p.used.toFixed(2), pacing: p.pacing });
  for (const x of p.byPlatform) console.log(' ', x.platform.padEnd(11), x.total.toFixed(2).padStart(14), x.used.toFixed(2).padStart(14), x.pacing?.toFixed(4));

  // a soma das plataformas fecha com o total sem filtro
  assert.ok(Math.abs(p.byPlatform.reduce((s, x) => s + x.total, 0) - p.total) < 0.01);

  // filtro de plataforma ajusta: Meta isolada == linha da Meta no detalhe
  const meta = aggregatePacing(await loadBudgetRows(pool, { from: FROM, to: TO, platform: ['meta'] }));
  const metaRow = p.byPlatform.find((x) => x.platform === 'meta');
  console.log('meta isolada:', meta.total.toFixed(2), meta.used.toFixed(2));
  assert.ok(metaRow && Math.abs(meta.total - metaRow.total) < 0.01 && Math.abs(meta.used - metaRow.used) < 0.01);

  // conferência direta do gasto de uma campanha Meta com orçamento: SUM(cost) do flight
  const one = all.find((r) => r.platform === 'meta' && r.level === 'campaign' && r.start && r.end);
  if (one) {
    const [r] = await pool.query(
      `SELECT SUM(cost) AS c FROM gold_platforms_campaigns WHERE platform='meta' AND campaign_id=? AND date BETWEEN ? AND LEAST(?, ?)`,
      [one.campaignId, one.start, one.end, TO]);
    const direto = Number((r as { c: string }[])[0]!.c);
    console.log('campanha', one.campaignId, 'consulta', one.used.toFixed(2), 'direto', direto.toFixed(2));
    assert.ok(Math.abs(direto - one.used) < 0.01);
  }
  // conjunto filtrado: só orçamento de conjunto, gasto = SUM(cost) do conjunto no flight
  const grp = all.find((r) => r.platform === 'meta' && r.level === 'ad_group');
  if (grp) {
    const [n] = await pool.query(`SELECT ad_group_name AS n FROM gold_platforms_campaigns WHERE platform='meta' AND campaign_id=? AND ad_group_name <> '' LIMIT 1`, [grp.campaignId]);
    const name = (n as { n: string }[])[0]?.n;
    const g = aggregatePacing(await loadBudgetRows(pool, { from: FROM, to: TO, adGroup: name ? [name] : [] }));
    console.log('conjunto', name, '->', g.total.toFixed(2), g.used.toFixed(2));
    assert.ok(g.total > 0 && g.total < metaRow!.total);
  }
  console.log('pacing-live: ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
