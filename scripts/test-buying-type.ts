// Check do filtro de tipo de compra (CPM/CPC/CPV/CPE):
//   npx tsx --env-file=.env.local scripts/test-buying-type.ts
//
// Vai ao banco de propósito: o que pode quebrar aqui é o vocabulário de `objective`
// mudar (plataforma nova, coluna repopulada) e o CASE parar de cobrir o volume.

import assert from 'node:assert/strict';
import { getPool } from '../lib/mysql';
import { BUYING_TYPE_SQL, HAS_DELIVERY, buildWhere, withBuyingCampaigns, type DashboardFilters } from '../lib/dashboard';

const FROM = '2026-01-01';
const TO = new Date().toISOString().slice(0, 10);
const TABLES = ['gold_platforms_campaigns', 'gold_platforms_regions', 'gold_platforms_age_gender'] as const;
const n = (v: unknown) => Number(v ?? 0);

async function main() {
  const pool = getPool();
  const rows = async <T>(sql: string, params: unknown[] = []) =>
    ((await pool.query(sql, params))[0] as T[]);

  // 1. Os quatro tipos + "sem tipo" particionam a janela.
  const buckets = await rows<{ bt: string; imp: string }>(
    `SELECT ${BUYING_TYPE_SQL} AS bt, SUM(impressions) imp FROM gold_platforms_campaigns
      WHERE date BETWEEN ? AND ? GROUP BY bt`, [FROM, TO]);
  const [{ imp: totalRaw }] = await rows<{ imp: string }>(
    `SELECT SUM(impressions) imp FROM gold_platforms_campaigns WHERE date BETWEEN ? AND ?`, [FROM, TO]);
  const total = n(totalRaw);
  const soma = buckets.reduce((a, b) => a + n(b.imp), 0);
  assert.equal(soma, total, `partição: soma dos tipos ${soma} != total ${total}`);
  assert.deepEqual(
    buckets.map((b) => b.bt).filter((b) => b).sort(), ['CPC', 'CPE', 'CPM', 'CPV'],
    'os quatro tipos têm de existir na janela');

  // 2. Só cai em "sem tipo" o que a gente já sabe que não é objetivo de compra: os
  //    formatos do GloboAds e o TARGET_SPEND do Google. Valor novo aqui = mapa a rever.
  const orfaos = await rows<{ objective: string; imp: string }>(
    `SELECT objective, SUM(impressions) imp FROM gold_platforms_campaigns
      WHERE date BETWEEN ? AND ? AND ${BUYING_TYPE_SQL} = '' AND objective IS NOT NULL
      GROUP BY objective HAVING SUM(impressions) > ? ORDER BY imp DESC`,
    [FROM, TO, total * 0.01]);
  const CONHECIDOS = new Set(['DIGITAL', 'Audio', 'DAI', 'DAI-A', 'TARGET_SPEND']);
  assert.deepEqual(
    orfaos.map((o) => o.objective).filter((o) => !CONHECIDOS.has(o)), [],
    `objective novo sem tipo acima de 1%: ${JSON.stringify(orfaos)}`);
  const semTipo = n(buckets.find((b) => !b.bt)?.imp);
  assert.ok(semTipo / total < 0.05, `"sem tipo" em ${((semTipo / total) * 100).toFixed(1)}% do volume`);

  // 3. Consistência entre abas: o tipo resolve para campaign_id na tabela de campanhas
  //    e as três tabelas respondem com o MESMO recorte (nenhuma aba zera).
  for (const bt of ['CPM', 'CPC', 'CPV', 'CPE']) {
    const base: DashboardFilters = { from: FROM, to: TO, buyingType: [bt] };
    const f = await withBuyingCampaigns(pool, base, 'gold_platforms_campaigns');
    const ids = f.buyingCampaignIds ?? [];
    assert.ok(ids.length, `${bt}: nenhuma campanha resolvida`);
    const w = buildWhere(f);
    const imps: number[] = [];
    for (const t of TABLES) {
      const [r] = await rows<{ imp: string }>(
        `SELECT SUM(impressions) imp FROM ${t} WHERE ${w.sql} AND (${HAS_DELIVERY})`, w.params);
      imps.push(n(r.imp));
    }
    assert.ok(imps.every((i) => i > 0), `${bt}: aba zerada — ${TABLES.map((t, i) => `${t}=${imps[i]}`).join(' ')}`);
    console.log(`${bt}: ${ids.length} campanhas · ` +
      TABLES.map((t, i) => `${t.replace('gold_platforms_', '')}=${imps[i].toLocaleString('pt-BR')}`).join(' · '));
  }

  const pct = (v: number) => `${((v / total) * 100).toFixed(1)}%`;
  console.log('\ncobertura:', buckets.sort((a, b) => n(b.imp) - n(a.imp))
    .map((b) => `${b.bt || 'sem tipo'} ${pct(n(b.imp))}`).join(' · '));
  console.log('OK');
  await pool.end();
}

main();
