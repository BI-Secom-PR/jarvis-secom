// Check da leitura pré-computada:  npx tsx scripts/test-dashboard-insights.ts
// Números do print do dashboard (Campanhas, 24–31/08/2026, 7 dias).

import assert from 'node:assert/strict';
import {
  alvoAchados, buildAchados, faixaNoAlvo, kpiDeltaLabel, parseAlvoIdade, penetracao, shortCampaignName,
  type AlvoRow, type DemoRow, type GeoRow, type NamedRow, type TotalsLite,
} from '../lib/dashboardInsights';
import { MACRO_BY_UF, POP_BY_UF, UF_BY_NAME } from '../lib/dashboard';

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
assert.ok(achados.some((a) => a.bloco === 'plataformas' && /Amazon DSP/.test(a.frase)), `pior plataforma ausente:\n${blob}`);
assert.ok(achados.some((a) => a.tipo === 'recomendacao' && /estimativa linear/i.test(a.frase)), `sem recomendação:\n${blob}`);
assert.ok(achados.length <= 9);

// Cliques: índice de eficiência por plataforma, anúncios, último dia e Δ por plataforma.
const ads: NamedRow[] = [
  { platform: 'tiktok', nome: 'VACINA_TIKTOK_15s_A', cost: 3000, impressions: 900_000, clicks: 12_000, ...z },
  { platform: 'google', nome: 'VACINA_YT_30s_B', cost: 40_000, impressions: 3_000_000, clicks: 200, ...z },
  { platform: 'globoads', nome: 'VACINA_GLOBO_BANNER', cost: 20_000, impressions: 1_500_000, clicks: 900, ...z },
];
const day = (date: string, impressions: number, clicks: number) =>
  ({ date, cost: impressions / 100, impressions, reach: 0, clicks, videoViews: 0, engagement: 0 });
const daily = [
  day('2026-08-24', 2_000_000, 4000), day('2026-08-25', 2_100_000, 4100), day('2026-08-26', 2_000_000, 3900),
  day('2026-08-27', 2_050_000, 4000), day('2026-08-28', 2_000_000, 4000), day('2026-08-29', 2_100_000, 4200),
  day('2026-08-30', 2_000_000, 2000),
];
const cliques = buildAchados({
  tab: 'campanhas', metric: 'cliques', totals, previous, campanhas: rows, anuncios: ads,
  daily, gran: 'dia', hoje: '2026-10-22',
  previousByPlatform: [{ platform: 'tiktok', cost: 5000, impressions: 1_000_000, reach: 0, clicks: 5000, videoViews: 0, engagement: 0 }],
});
const cBlob = cliques.map((a) => `[${a.bloco}] ${a.frase}`).join('\n');
assert.ok(cliques.some((a) => a.bloco === 'tendencia' && /CTR/.test(a.frase)), `decomposição ausente:\n${cBlob}`);
assert.ok(cliques.some((a) => a.bloco === 'dia' && /30\/08 fechou/.test(a.frase) && /−50%/.test(a.frase)), `último dia ausente:\n${cBlob}`);
assert.ok(cliques.some((a) => a.bloco === 'plataformas' && /TikTok/.test(a.frase) && /era R\$ 1,00/.test(a.frase)), `Δ TikTok ausente:\n${cBlob}`);
assert.ok(cliques.some((a) => a.bloco === 'anuncios' && /VACINA_TIKTOK_15s_A/.test(a.frase) && /VACINA_YT_30s_B/.test(a.frase)), `anúncios ausentes:\n${cBlob}`);
assert.ok(cliques.some((a) => a.bloco === 'recomendacao'), `sem recomendação de cliques:\n${cBlob}`);
// Ordem de exibição = ordem dos blocos; recomendação fecha.
assert.equal(cliques[cliques.length - 1]!.bloco, 'recomendacao');

// Print do usuário: cliques 34 mil → 1,0 mi é cobertura, não crescimento.
const salto = buildAchados({
  tab: 'campanhas', metric: 'cliques', campanhas: rows,
  totals: { ...totals, impressions: 142_800_000, clicks: 1_000_000, cost: 230_000 },
  previous: { ...previous, impressions: 20_100_000, clicks: 34_000, cost: 25_600 },
});
assert.ok(salto.some((a) => a.tipo === 'anomalia'), 'salto de cliques deveria ser anomalia');
assert.ok(salto.some((a) => a.tipo === 'mix_vs_rate' && /CPM/.test(a.frase)), 'anomalia deveria cair na leitura por CPM');

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
for (const a of [...achados, ...cliques]) console.log(`  [${a.bloco}/${a.tipo}] ${a.frase}`);

// VTR > 100% (views > impressões) não pode virar "melhor anúncio".
const vtr = buildAchados({
  tab: 'campanhas', metric: 'vtr', totals, campanhas: rows,
  anuncios: [
    { platform: 'globoads', nome: 'PRE_ROLL_QUEBRADO', cost: 5000, impressions: 100_000, clicks: 0, reach: 0, videoViews: 100_330, engagement: 0 },
    { platform: 'tiktok', nome: 'VIDEO_OK_A', cost: 5000, impressions: 100_000, clicks: 0, reach: 0, videoViews: 21_000, engagement: 0 },
    { platform: 'google', nome: 'VIDEO_OK_B', cost: 5000, impressions: 100_000, clicks: 0, reach: 0, videoViews: 9_000, engagement: 0 },
  ],
});
assert.ok(!vtr.some((a) => /PRE_ROLL_QUEBRADO/.test(a.frase)), 'VTR > 100% entrou no ranking');
assert.ok(vtr.some((a) => a.bloco === 'anuncios' && /VIDEO_OK_A/.test(a.frase)));
console.log('ok — VTR > 100% fora do ranking');

// Foco em campanha: referência contra as demais (geral e dentro da plataforma principal).
const elNino: NamedRow[] = [
  { platform: 'tiktok', nome: '2026 | EL NINO | VISUALIZAÇÃO', cost: 4000, impressions: 2_000_000, clicks: 400_000, ...z },
  { platform: 'meta', nome: '2026 | EL NINO | ALCANCE', cost: 6000, impressions: 1_500_000, clicks: 9_000, ...z },
];
const elTot = elNino.reduce((a, r) => ({ ...a, cost: a.cost + r.cost, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks }),
  { cost: 0, impressions: 0, clicks: 0, reach: 0, videoViews: 0, engagement: 0 });
const foco = buildAchados({
  tab: 'campanhas', metric: 'cliques', totals: elTot, campanhas: elNino,
  referencia: { foco: 'campanha', nome: 'EL NINO', porPlataforma: [
    { platform: 'tiktok', cost: 24_000, impressions: 8_000_000, clicks: 450_000, reach: 0, videoViews: 0, engagement: 0 },
    { platform: 'meta', cost: 106_000, impressions: 21_500_000, clicks: 109_000, reach: 0, videoViews: 0, engagement: 0 },
  ] },
});
const ref = foco.find((a) => a.bloco === 'referencia');
assert.ok(ref, `referência ausente:\n${foco.map((a) => a.frase).join('\n')}`);
// EL NINO CPC 10000/409000 = R$ 0,02; demais 120000/150000 = R$ 0,80 → 32,7× → "33×".
assert.match(ref!.frase, /EL NINO: CPC R\$ 0,02 contra R\$ 0,80 das demais campanhas/);
assert.match(ref!.frase, /33× mais eficiente/);
// Meta é onde EL NINO mais gasta: 6000/9000 = R$ 0,67 vs (100000/100000) = R$ 1,00.
assert.ok(foco.some((a) => a.bloco === "referencia" && /^No Meta, R\$ 0,67 contra R\$ 1,00 das outras campanhas/.test(a.frase)));

// Foco em plataforma: redes do Meta comparadas, recomendação desce para rede.
const meta: NamedRow[] = [
  { platform: 'meta', nome: 'CAMP A', cost: 10_000, impressions: 3_000_000, clicks: 20_000, ...z },
];
const metaFoco = buildAchados({
  tab: 'campanhas', metric: 'cliques', totals: { ...meta[0]! }, campanhas: meta,
  redes: [
    { platform: 'meta', network: 'instagram', cost: 3000, impressions: 1_500_000, clicks: 15_000, reach: 0, videoViews: 0, engagement: 0 },
    { platform: 'meta', network: 'facebook', cost: 7000, impressions: 1_500_000, clicks: 5_000, reach: 0, videoViews: 0, engagement: 0 },
  ],
  referencia: { foco: 'plataforma', nome: 'meta', porPlataforma: [
    { platform: 'meta', cost: 10_000, impressions: 3_000_000, clicks: 20_000, reach: 0, videoViews: 0, engagement: 0 },
    { platform: 'tiktok', cost: 10_000, impressions: 3_000_000, clicks: 10_000, reach: 0, videoViews: 0, engagement: 0 },
  ] },
});
const mBlob = metaFoco.map((a) => `[${a.bloco}] ${a.frase}`).join('\n');
assert.ok(metaFoco.some((a) => a.bloco === 'redes' && /^Instagram entrega 75% dos cliques com 30% do gasto/.test(a.frase)), `redes ausente:\n${mBlob}`);
assert.ok(metaFoco.some((a) => a.bloco === 'referencia' && /Meta: CPC R\$ 0,50 contra R\$ 1,00 das demais plataformas/.test(a.frase)), `ref Meta ausente:\n${mBlob}`);
assert.ok(metaFoco.some((a) => a.bloco === 'recomendacao' && /de Facebook .* para Instagram/.test(a.frase)), `rec por rede ausente:\n${mBlob}`);
assert.ok(!metaFoco.some((a) => a.bloco === 'plataformas'), 'plataforma única não tem ranking de plataformas');
console.log('ok — foco em campanha e em plataforma');
for (const a of [...foco, ...metaFoco]) console.log(`  [${a.bloco}] ${a.frase}`);

// ── Idade & Gênero: mix, viés de plataforma, faixa × gênero, público-alvo ──
const d = (platform: string, faixa: string, gender: string, cost: number, impressions: number, clicks: number): DemoRow =>
  ({ platform, faixa, gender, cost, impressions, clicks, reach: 0, videoViews: 0, engagement: 0 });
const demoPlat: DemoRow[] = [
  d('tiktok', '18-24', 'MULHER', 3000, 3_000_000, 30_000), d('tiktok', '18-24', 'HOMEM', 2000, 2_000_000, 12_000),
  d('tiktok', '25-34', 'MULHER', 1000, 800_000, 4000),
  d('meta', '25-34', 'MULHER', 4000, 1_500_000, 6000), d('meta', '25-34', 'HOMEM', 3000, 1_500_000, 3000),
  d('meta', '35-44', 'MULHER', 2000, 1_000_000, 2500), d('meta', '13-17', 'HOMEM', 800, 400_000, 1200),
  d('meta', 'n/d', 'DESCONHECIDO', 500, 700_000, 400),
];
const colapsa = (rs: DemoRow[]) => [...rs.reduce((m, r) => {
  const k = `${r.faixa}|${r.gender}`, c = m.get(k);
  m.set(k, c ? { ...c, cost: c.cost + r.cost, impressions: c.impressions + r.impressions, clicks: c.clicks + r.clicks } : { ...r, platform: undefined });
  return m;
}, new Map<string, DemoRow>()).values()];
const demoPrev = colapsa([
  d('tiktok', '18-24', 'MULHER', 500, 500_000, 4000), d('meta', '25-34', 'MULHER', 4000, 3_000_000, 9000),
  d('meta', '25-34', 'HOMEM', 3000, 2_500_000, 5000), d('meta', '35-44', 'MULHER', 2000, 1_500_000, 3000),
]);
const alvoRows: AlvoRow[] = [
  { targetAge: '18+', targetGender: 'AS', faixa: '13-17', gender: 'HOMEM', cost: 800, impressions: 400_000, clicks: 1200, reach: 0, videoViews: 0, engagement: 0 },
  { targetAge: '18+', targetGender: 'AS', faixa: '25-34', gender: 'MULHER', cost: 5000, impressions: 2_300_000, clicks: 10_000, reach: 0, videoViews: 0, engagement: 0 },
  { targetAge: '25 A 44', targetGender: 'M', faixa: '25-34', gender: 'HOMEM', cost: 3000, impressions: 1_500_000, clicks: 3000, reach: 0, videoViews: 0, engagement: 0 },
  { targetAge: null, targetGender: null, faixa: '18-24', gender: 'MULHER', cost: 3000, impressions: 3_000_000, clicks: 30_000, reach: 0, videoViews: 0, engagement: 0 },
];
const demoOut2 = buildAchados({
  tab: 'demografia', metric: 'cliques', demografia: colapsa(demoPlat), demografiaPlat: demoPlat,
  previousDemografia: demoPrev, alvo: alvoRows, redeFiltrada: true,
});
const dBlob = demoOut2.map((a) => `[${a.bloco}] ${a.frase}`).join('\n');
assert.ok(demoOut2.some((a) => a.bloco === 'tendencia' && /^Mix de cliques vs janela anterior: faixa 18-24 foi de/.test(a.frase)), `mix ausente:\n${dBlob}`);
assert.ok(demoOut2.some((a) => a.bloco === 'plataformas' && /TikTok concentra \d+% em faixa 18-24/.test(a.frase)), `viés ausente:\n${dBlob}`);
assert.ok(demoOut2.some((a) => a.bloco === 'eficiencia' && /Mulher 18-24/.test(a.frase)), `célula faixa×gênero ausente:\n${dBlob}`);
assert.ok(demoOut2.some((a) => a.bloco === 'recomendacao' && /fora do público-alvo, sobretudo no gênero Homem/.test(a.frase)), `alvo ausente:\n${dBlob}`);
assert.ok(demoOut2.some((a) => a.bloco === 'cobertura' && /filtro de rede não vale/.test(a.frase)), 'ressalva de rede ausente');
assert.ok(buildAchados({ tab: 'demografia', metric: 'impressoes', demografia: colapsa(demoPlat) })
  .some((a) => /sem gênero identificado/.test(a.frase)), 'cobertura de gênero ausente');
assert.ok(!demoOut2.some((a) => a.bloco === 'plataformas' && /Kwai/.test(a.frase)), 'Kwai não está nos dados');

// Sem plataforma única, sem janela anterior e sem alvo: nada de viés, mix ou aderência inventados.
const demoMin = buildAchados({ tab: 'demografia', metric: 'cliques', demografia: colapsa(demoPlat) });
assert.ok(!demoMin.some((a) => /Mix de|concentra|público-alvo/.test(a.frase)), 'achado sem base');

// Foco em plataforma: composição do foco × demais.
const demoFoco = buildAchados({
  tab: 'demografia', metric: 'impressoes',
  demografia: colapsa(demoPlat.filter((r) => r.platform === 'tiktok')),
  refDemografia: colapsa(demoPlat), focoDim: { foco: 'plataforma', nome: 'tiktok' },
});
assert.ok(demoFoco.some((a) => a.bloco === 'referencia' && /^TikTok: em impressões, faixa 18-24 pesa \d+% contra \d+% das demais plataformas/.test(a.frase)),
  `ref de mix ausente:\n${demoFoco.map((a) => `[${a.bloco}] ${a.frase}`).join('\n')}`);

// Parser do alvo (formatos vistos ao vivo em 2026-10-23: '18+', '18 A 34', '25+', null).
assert.deepEqual(parseAlvoIdade('18+'), [18, 200]);
assert.deepEqual(parseAlvoIdade('25 A 44'), [25, 44]);
assert.equal(parseAlvoIdade('texto livre'), null);
assert.equal(parseAlvoIdade(null), null);
assert.equal(faixaNoAlvo('13-17', '18+'), false);
assert.equal(faixaNoAlvo('25-34', '18 A 29'), true, 'sobreposição parcial conta como dentro');
assert.equal(faixaNoAlvo('55+', '25 A 44'), false);
assert.equal(faixaNoAlvo('n/d', '18+'), null);
assert.equal(faixaNoAlvo('25-34', null), null);
// Alvo declarado em quase nada: só a ressalva, sem inventar aderência.
const alvoPouco = alvoAchados([
  { ...alvoRows[1]!, targetAge: null, targetGender: null },
  { ...alvoRows[0]!, impressions: 50_000 },
], 'cliques');
assert.ok(alvoPouco.length === 1 && /Só \d+% da entrega tem público-alvo declarado/.test(alvoPouco[0]!.frase), 'cobertura de alvo');
assert.ok(alvoAchados([], 'cliques').length === 0);
console.log('ok — idade & gênero');
for (const a of demoOut2) console.log(`  [${a.bloco}/${a.tipo}] ${a.frase}`);

// ── Região: macrorregião, penetração, mix de UF ────────────────────────────
// Tabelas estáticas: toda UF do mapa tem macro e população; Brasil 2022 = 203,08 mi.
for (const uf of Object.values(UF_BY_NAME)) assert.ok(MACRO_BY_UF[uf] && POP_BY_UF[uf], `${uf} sem macro/população`);
assert.equal(Object.keys(POP_BY_UF).length, 27);
assert.equal(Object.values(POP_BY_UF).reduce((a, b) => a + b, 0), 203_080_756, 'soma do Censo 2022');
assert.deepEqual([...new Set(Object.values(MACRO_BY_UF))].sort(), ['Centro-Oeste', 'Nordeste', 'Norte', 'Sudeste', 'Sul']);

const nomeUf = Object.fromEntries(Object.entries(UF_BY_NAME).map(([n, u]) => [u, n]));
const g = (uf: string | null, impressions: number, clicks: number, platform?: string): GeoRow =>
  ({ uf, estado: uf ? nomeUf[uf]! : 'Outro', platform, cost: impressions / 1000, impressions, clicks, reach: 0, videoViews: 0, engagement: 0 });
// Entrega concentrada no Sudeste; Nordeste (BA, PE, CE, MA) bem abaixo do peso demográfico.
const geoRows: GeoRow[] = [
  g('SP', 6_000_000, 30_000), g('RJ', 3_000_000, 12_000), g('MG', 2_500_000, 9000), g('ES', 300_000, 900),
  g('PR', 900_000, 2700), g('RS', 800_000, 2400), g('SC', 500_000, 1500),
  g('BA', 150_000, 300), g('PE', 100_000, 200), g('CE', 100_000, 200), g('MA', 50_000, 100),
  g('GO', 400_000, 1200), g('DF', 300_000, 900), g(null, 400_000, 400),
];
const geoPrev: GeoRow[] = geoRows.map((r) => ({ ...r, impressions: r.uf === 'BA' ? r.impressions * 6 : r.impressions, cost: r.uf === 'BA' ? r.cost * 6 : r.cost }));
const geoOut2 = buildAchados({ tab: 'regiao', metric: 'impressoes', regioes: geoRows, previousRegioes: geoPrev, redeFiltrada: false });
const gBlob = geoOut2.map((a) => `[${a.bloco}] ${a.frase}`).join('\n');
assert.ok(geoOut2.some((a) => a.bloco === 'distribuicao' && /Por macrorregião, Sudeste lidera/.test(a.frase)), `macro ausente:\n${gBlob}`);
assert.ok(!/Nordeste somado/.test(gBlob), 'o NE fixo saiu');
assert.ok(geoOut2.some((a) => a.bloco === 'recomendacao' && /Censo 2022\), Rio de Janeiro recebe 2,5× .* e Pará não recebeu entrega/.test(a.frase)), `penetração ausente:\n${gBlob}`);
assert.ok(geoOut2.some((a) => a.bloco === 'tendencia' && /Mix de impressões vs janela anterior: .*(Bahia perdeu|perdeu)/.test(a.frase)), `mix de UF ausente:\n${gBlob}`);
assert.ok(geoOut2.some((a) => a.bloco === 'cobertura' && /não são UFs brasileiras/.test(a.frase)), 'UF sem nome fora do ranking');
// Entrega num punhado de UFs (campanha regional): sem penetração, que viraria alarme falso.
assert.equal(penetracao([g('SP', 6_000_000, 0), g('RJ', 3_000_000, 0), g('MG', 2_000_000, 0)]).length, 0);
// Macrorregiões particionam o total.
const somaMacro = new Map<string, number>();
for (const r of geoRows) if (r.uf) somaMacro.set(MACRO_BY_UF[r.uf]!, (somaMacro.get(MACRO_BY_UF[r.uf]!) ?? 0) + r.impressions);
assert.equal([...somaMacro.values()].reduce((a, b) => a + b, 0), geoRows.filter((r) => r.uf).reduce((a, r) => a + r.impressions, 0));
console.log('ok — região');
for (const a of geoOut2) console.log(`  [${a.bloco}/${a.tipo}] ${a.frase}`);
