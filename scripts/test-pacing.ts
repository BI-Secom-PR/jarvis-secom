// Check da agregação do pacing (pura, sem banco):
//   npx tsx scripts/test-pacing.ts
import assert from 'node:assert/strict';
import { aggregatePacing, flightTotal, type BudgetRow } from '../lib/pacing';

const row = (o: Partial<BudgetRow>): BudgetRow => ({
  platform: 'meta', level: 'campaign', campaignId: 'c1', amount: 1000, daily: false,
  start: null, end: null, used: 400, ...o,
});

// campanha + conjuntos do mesmo campaign_id: vale só a campanha
let p = aggregatePacing([row({}), row({ level: 'ad_group', amount: 600, used: 250 }), row({ level: 'ad_group', amount: 400, used: 150 })]);
assert.equal(p.total, 1000); assert.equal(p.used, 400); assert.equal(p.left, 600); assert.equal(p.pacing, 0.4);

// sem linha de campanha: somam-se os conjuntos
p = aggregatePacing([row({ level: 'ad_group', amount: 600, used: 250 }), row({ level: 'ad_group', amount: 400, used: 150 })]);
assert.equal(p.total, 1000); assert.equal(p.used, 400);

// diário × dias do flight (inclusivo)
assert.equal(flightTotal(row({ daily: true, amount: 100, start: '2026-10-01', end: '2026-10-10' })), 1000);
// diário sem datas: não há como multiplicar
assert.equal(flightTotal(row({ daily: true, amount: 100 })), 100);

// plataformas separadas, ordenadas por orçado; total 0 não divide
p = aggregatePacing([row({ platform: 'tiktok', amount: 50, used: 10 }), row({ campaignId: 'c2' })]);
assert.deepEqual(p.byPlatform.map((x) => x.platform), ['meta', 'tiktok']);
assert.equal(aggregatePacing([]).pacing, null);
console.log('pacing: ok');
