// Check da leitura pré-computada:  npx tsx scripts/test-dashboard-insights.ts
// Números do print do dashboard (Campanhas, 24–31/08/2026, 7 dias).

import assert from 'node:assert/strict';
import {
  buildAchados, kpiDeltaLabel, shortCampaignName, type NamedRow, type TotalsLite,
} from '../lib/dashboardInsights';

const z = { reach: 0, videoViews: 0, engagement: 0 };

const rows: NamedRow[] = [
  { platform: 'google', nome: '2026 | CAMPANHA ATUALIZAÇÃO DA CADERNETA DE VACINAÇÃO 20260021 | CPV | NOVA | PI 331808',
    cost: 86135.88, impressions: 6_231_960, clicks: 376, ...z },
  { platform: 'amazon_dsp', nome: '2026 | CAMPANHA NACIONAL DE ATUALIZAÇÃO DA CADERNETA DE VACINAÇÃO 2026 | Alcance | Nacional PI 127490',
    cost: 65636.08, impressions: 1_048_091, clicks: 0, ...z },
  { platform: 'globoads', nome: '90623_Secom_Calia_Midia Avulsa_Campanha Multivacinação_Agosto26_PI 141865_IGN',
    cost: 37004.47, impressions: 3_083_758, clicks: 1312, ...z },
  { platform: 'globoads', nome: '90555_Secom_Calia_Midia Avulsa_Campanha Nacional de Multivacinação_Agosto26_IGN',
    cost: 26606.00, impressions: 717_435, clicks: 0, ...z },
  { platform: 'globoads', nome: '90641_Secom_Propeg_Midia Avulsa_Campanha Multivacinação_Comercial Amplificado_Agosto26_352.226_IGN',
    cost: 21852.00, impressions: 655_367, clicks: 0, ...z },
  { platform: 'globoads', nome: '90644_Secom_Nova S.A_Midia Avulsa_Comercial Amplificado_Multivacinação_Agosto26_PI 331807_IGN',
    cost: 13659.00, impressions: 530_591, clicks: 0, ...z },
  { platform: 'globoads', nome: '90687_Secom_Calia_Midia Avulsa_Campanha Multivacinação_Agosto26_PI 141862_IGN',
    cost: 11637.00, impressions: 541_155, clicks: 0, ...z },
  { platform: 'kwai', nome: '2026 | CAMPANHA ATUALIZAÇÃO DA CADERNETA DE VACINAÇÃO 20260021 | VISUALIZAÇÃO | NACIONAL',
    cost: 7435.19, impressions: 1_721_925, clicks: 6318, ...z },
  { platform: 'tiktok', nome: '2026 | CAMPANHA ATUALIZAÇÃO DA CADERNETA DE VACINAÇÃO 20260021 | VISUALIZAÇÃO | NACIONAL',
    cost: 7087.64, impressions: 1_706_673, clicks: 19080, ...z },
  { platform: 'pinterest', nome: '2026 | CAMPANHA ATUALIZAÇÃO DA CADERNETA DE VACINAÇÃO 20260021 | VISUALIZAÇÃO | NACIONAL',
    cost: 2936.23, impressions: 257_999, clicks: 1072, ...z },
];

const totals: TotalsLite = {
  cost: 279_989.29, impressions: 16_494_954, reach: 1_665_880,
  clicks: 28_158, videoViews: 6_315_577, engagement: 58_834,
};
const previous: TotalsLite = {
  cost: 43_301.7, impressions: 4_142_063, reach: 216,
  clicks: 9716, videoViews: 3_051_003, engagement: 0,
};

assert.equal(
  shortCampaignName(rows[0]!.nome),
  'CAMPANHA ATUALIZAÇÃO DA CADERNETA DE VACINAÇÃO 20260021',
);

const dReach = kpiDeltaLabel(totals.reach, previous.reach);
assert.equal(dReach.text, 'cobertura mudou');
assert.equal(dReach.color, 'none');
assert.equal(kpiDeltaLabel(totals.engagement, 0).text, 'sem base');
const dImp = kpiDeltaLabel(totals.impressions, previous.impressions);
assert.match(dImp.text, /\+298/);
assert.equal(dImp.color, 'up');

const achados = buildAchados({ tab: 'campanhas', metric: 'impressoes', totals, previous, campanhas: rows });
const blob = achados.map((a) => a.frase).join('\n');

assert.ok(achados.some((a) => a.tipo === 'mix_vs_rate'), 'mix vs rate ausente');
assert.match(blob, /CPM/);
assert.match(blob, /investimento/);
assert.equal(achados.some((a) => /Pinterest/i.test(a.frase) && /menor/i.test(a.frase)), false);
assert.ok(/TikTok/i.test(blob), `TikTok ausente:\n${blob}`);
assert.match(blob, /cliques/);
assert.ok(achados.some((a) => a.tipo === 'recomendacao'), `sem recomendação:\n${blob}`);
assert.doesNotMatch(blob, /771/);

const alcance = buildAchados({ tab: 'campanhas', metric: 'alcance', totals, previous, campanhas: rows });
assert.ok(alcance.some((a) => a.tipo === 'anomalia'), 'anomalia de alcance ausente');
assert.match(alcance.map((a) => a.frase).join(' '), /não leia como crescimento/i);

const demo = buildAchados({
  tab: 'demografia', metric: 'impressoes',
  demografia: [
    { faixa: '25-34', gender: 'MULHER', cost: 10, impressions: 60, reach: 0, clicks: 0, videoViews: 0, engagement: 0 },
    { faixa: '25-34', gender: 'HOMEM', cost: 10, impressions: 20, reach: 0, clicks: 0, videoViews: 0, engagement: 0 },
    { faixa: 'n/d', gender: 'DESCONHECIDO', cost: 5, impressions: 20, reach: 0, clicks: 0, videoViews: 0, engagement: 0 },
  ],
});
assert.ok(demo.some((a) => /Mulher/.test(a.frase)));
assert.ok(demo.some((a) => /faixa etária/.test(a.frase)));

console.log('ok — leitura do dashboard\n');
for (const a of achados) console.log(`  [${a.tipo}] ${a.frase}`);
