// Check das métricas derivadas do seletor:  npx tsx scripts/test-derived-metrics.ts
// CPC/CPV/CPE/VTR/Tx.Eng. são calculadas no cliente (metricValue) e precisam bater
// com o catálogo de export (EXPORT_COLUMNS) — as duas cópias de fórmula não podem divergir.

import assert from 'node:assert/strict';
import { METRICS, isMetricKey, type MetricKey } from '../lib/dashboard';
import { metricValue, buildAchados, type TotalsLite, type DemoRow, type GeoRow } from '../lib/dashboardInsights';
import { EXPORT_COLUMNS, type ExportRow } from '../lib/dashboardExport';

const zParts = { likes: 0, comments: 0, shares: 0, reactions: 0, saves: 0 };
const row: TotalsLite = { cost: 100, impressions: 1000, reach: 500, clicks: 50, videoViews: 200, engagement: 40 };

// ── fórmulas ──
assert.equal(metricValue(row, 'cpc'), 2, 'CPC = 100/50');
assert.equal(metricValue(row, 'cpv'), 0.5, 'CPV = 100/200');
assert.equal(metricValue(row, 'cpe'), 2.5, 'CPE = 100/40');
assert.equal(metricValue(row, 'vtr'), 20, 'VTR = 200/1000*100');
assert.equal(metricValue(row, 'tx_eng'), 4, 'Tx.Eng = 40/1000*100');

// ── denominador zero → NaN (não "R$ 0,00") ──
assert.ok(Number.isNaN(metricValue({ ...row, clicks: 0 }, 'cpc')));
assert.ok(Number.isNaN(metricValue({ ...row, videoViews: 0 }, 'cpv')));
assert.ok(Number.isNaN(metricValue({ ...row, engagement: 0 }, 'cpe')));
assert.ok(Number.isNaN(metricValue({ ...row, impressions: 0 }, 'vtr')));
assert.ok(Number.isNaN(metricValue({ ...row, impressions: 0 }, 'tx_eng')));

// ── metadados ──
for (const k of ['cpc', 'cpv', 'cpe', 'vtr', 'tx_eng'] as MetricKey[]) assert.ok(isMetricKey(k), k);
assert.equal(METRICS.cpc.kind, 'currency');
assert.equal(METRICS.cpv.kind, 'currency');
assert.equal(METRICS.cpe.kind, 'currency');
assert.equal(METRICS.vtr.kind, 'pct');
assert.equal(METRICS.tx_eng.kind, 'pct');

// ── paridade com o export (mesma linha, mesma fórmula) ──
const xr: ExportRow = {
  platform: '', campanha: '', anuncio: '', faixa: '', gender: '', uf: '', estado: '',
  ...zParts, ...row, video_views: row.videoViews,
  p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, completions: 0,
};
assert.equal(metricValue(row, 'cpc'), EXPORT_COLUMNS.cpc.value(xr));
assert.equal(metricValue(row, 'cpv'), EXPORT_COLUMNS.cpv.value(xr));
assert.equal(metricValue(row, 'cpe'), EXPORT_COLUMNS.cpe.value(xr));
assert.equal(metricValue(row, 'vtr'), EXPORT_COLUMNS.vtr.value(xr));
assert.equal(metricValue(row, 'tx_eng'), EXPORT_COLUMNS.tx_eng.value(xr));

// ── razão agregada: soma numerador/denominador ANTES de dividir, nunca média de razões ──
// Duas fatias: CPC 2 (10/5) e CPC 4 (20/5). Agregado = 30/10 = 3, não (2+4)/2.
const demo: DemoRow[] = [
  { faixa: '25-34', gender: 'male', cost: 10, impressions: 100, reach: 0, clicks: 5, videoViews: 0, engagement: 0 },
  { faixa: '25-34', gender: 'female', cost: 20, impressions: 100, reach: 0, clicks: 5, videoViews: 0, engagement: 0 },
];
const demoOut = buildAchados({ tab: 'demografia', metric: 'cpc', demografia: demo });
const demoBlob = demoOut.map((a) => a.frase).join('\n');
assert.doesNotMatch(demoBlob, /% do total/, 'razão não deve falar em "% do total"');
assert.doesNotMatch(demoBlob, /R\$ 0,00/, 'sem CPC zerado espúrio');

// geoAchados de razão: magnitude, sem share
const geo: GeoRow[] = [
  { uf: 'SP', estado: 'São Paulo', cost: 100, impressions: 1000, reach: 0, clicks: 100, videoViews: 0, engagement: 0 },
  { uf: 'RJ', estado: 'Rio de Janeiro', cost: 100, impressions: 1000, reach: 0, clicks: 25, videoViews: 0, engagement: 0 },
];
const geoOut = buildAchados({ tab: 'regiao', metric: 'cpc', regioes: geo });
const geoBlob = geoOut.map((a) => a.frase).join('\n');
assert.doesNotMatch(geoBlob, /% do total|responde por/, 'razão por UF não é share');
assert.match(geoBlob, /Rio de Janeiro/, 'RJ (CPC 4) é o maior');

console.log('ok — métricas derivadas');
