// Achados da leitura do dashboard. Tudo é puro: o cliente mostra as frases
// como fallback e a rota de insights só pede ao modelo que as redija.
// Números vêm de somas (nunca média de taxas). Piso de 10 mil impressões
// para falar de eficiência — o mesmo do fallback antigo.

import {
  AGE_ORDER, GENDER_LABEL, GENDERS, METRICS, platformLabel,
  type MetricKey,
} from '@/lib/dashboard';

export type InsightTab = 'campanhas' | 'demografia' | 'regiao';
export type AchadoTipo =
  | 'lider' | 'mix_vs_rate' | 'outlier' | 'anomalia' | 'caveat' | 'recomendacao';
export type Achado = { tipo: AchadoTipo; frase: string };

export type TotalsLite = {
  cost: number; impressions: number; reach: number;
  clicks: number; videoViews: number; engagement: number;
};
export type NamedRow = TotalsLite & { nome: string; platform: string };
export type DemoRow = TotalsLite & { faixa: string; gender: string };
export type GeoRow = TotalsLite & { uf: string; estado: string };

const PISO = 10_000;
const MAX = 4;
const NE = ['BA', 'CE', 'PE', 'MA', 'PB', 'AL', 'PI', 'RN', 'SE'];

const nf = (v: number, d = 0) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number) => `R$ ${nf(v, 2)}`;
const pct = (v: number, d = 0) => `${nf(v, d)}%`;
const div = (a: number, b: number) => (b ? a / b : 0);
const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf(v / 1e9, 2)} bi`;
  if (a >= 1e6) return `${nf(v / 1e6, 1)} mi`;
  if (a >= 1e3) return `${nf(v / 1e3, 0)} mil`;
  return nf(Math.round(v));
};

/** Mirrors metricValue in components/DashboardContainer — razão sem denominador → NaN. */
export function metricValue(t: TotalsLite, m: MetricKey): number {
  switch (m) {
    case 'investimento': return t.cost;
    case 'impressoes': return t.impressions;
    case 'alcance': return t.reach;
    case 'cliques': return t.clicks;
    case 'visualizacoes': return t.videoViews;
    case 'engajamento': return t.engagement;
    case 'ctr': return div(t.clicks, t.impressions) * 100;
    case 'cpc': return t.clicks ? t.cost / t.clicks : NaN;
    case 'cpv': return t.videoViews ? t.cost / t.videoViews : NaN;
    case 'cpe': return t.engagement ? t.cost / t.engagement : NaN;
    case 'vtr': return t.impressions ? (t.videoViews / t.impressions) * 100 : NaN;
    case 'tx_eng': return t.impressions ? (t.engagement / t.impressions) * 100 : NaN;
  }
}

/** Métrica de uma fatia de sub-linhas: razão soma numerador e denominador antes de dividir. */
function aggMetric(rows: TotalsLite[], m: MetricKey): number {
  if (METRICS[m].kind === 'count') return rows.reduce((s, r) => s + metricValue(r, m), 0);
  const t = rows.reduce(
    (a, r) => ({
      cost: a.cost + r.cost, impressions: a.impressions + r.impressions, reach: a.reach + r.reach,
      clicks: a.clicks + r.clicks, videoViews: a.videoViews + r.videoViews, engagement: a.engagement + r.engagement,
    }),
    { cost: 0, impressions: 0, reach: 0, clicks: 0, videoViews: 0, engagement: 0 },
  );
  return metricValue(t, m);
}

const fmtM = (v: number, m: MetricKey) =>
  !Number.isFinite(v) ? '—'
    : METRICS[m].kind === 'currency' ? brl(v)
    : METRICS[m].kind === 'pct' ? pct(v, 2)
    : compact(v);

/** Trecho entre o 1º e o 2º "|" — mesma regra de fallback dos grupos. */
export function shortCampaignName(nome: string): string {
  const parts = nome.split('|').map((s) => s.trim()).filter(Boolean);
  const raw = parts.length >= 2 ? parts[1] : nome;
  return raw.length > 64 ? raw.slice(0, 63) + '…' : raw;
}

export function kpiDeltaLabel(now: number, before: number | null | undefined): {
  text: string; color: 'up' | 'down' | 'none';
} {
  if (before == null) return { text: '—', color: 'none' };
  if (before === 0) return { text: 'sem base', color: 'none' };
  const delta = ((now - before) / before) * 100;
  if (Math.abs(delta) > 1000) return { text: 'cobertura mudou', color: 'none' };
  const up = delta >= 0;
  return {
    text: `${up ? '▲' : '▼'} ${up ? '+' : ''}${nf(delta, 1)}%`,
    color: up ? 'up' : 'down',
  };
}

const cpmOf = (t: TotalsLite) => div(t.cost, t.impressions) * 1000;
const ctrOf = (t: TotalsLite) => div(t.clicks, t.impressions) * 100;
const deltaPct = (now: number, before: number) => (before ? ((now - before) / before) * 100 : null);

const VOLUME_METRICS: MetricKey[] = [
  'impressoes', 'alcance', 'investimento', 'cliques', 'visualizacoes', 'engajamento',
];

function unitOf(t: TotalsLite, m: MetricKey): { label: string; value: number } | null {
  // Métrica que já é razão (ctr/cpc/cpv/cpe/vtr/tx_eng) não tem "unit economics" companheira.
  if (!VOLUME_METRICS.includes(m)) return null;
  if (m === 'impressoes' || m === 'alcance' || m === 'investimento')
    return t.impressions ? { label: 'CPM', value: cpmOf(t) } : null;
  const v = metricValue(t, m);
  if (!v || !t.cost) return null;
  const nome = m === 'cliques' ? 'CPC' : m === 'visualizacoes' ? 'CPV' : 'CPE';
  return { label: nome, value: t.cost / v };
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function sumPlatforms(rows: NamedRow[]): NamedRow[] {
  const map = new Map<string, NamedRow>();
  for (const r of rows) {
    const cur = map.get(r.platform);
    if (!cur) {
      map.set(r.platform, { ...r, nome: platformLabel(r.platform) });
      continue;
    }
    map.set(r.platform, {
      ...cur,
      cost: cur.cost + r.cost,
      impressions: cur.impressions + r.impressions,
      reach: cur.reach + r.reach,
      clicks: cur.clicks + r.clicks,
      videoViews: cur.videoViews + r.videoViews,
      engagement: cur.engagement + r.engagement,
    });
  }
  return [...map.values()];
}

function pick(items: Achado[]): Achado[] {
  const rec = items.find((a) => a.tipo === 'recomendacao');
  const order: AchadoTipo[] = ['mix_vs_rate', 'anomalia', 'outlier', 'lider', 'caveat'];
  const out: Achado[] = [];
  const cap = rec ? MAX - 1 : MAX;
  for (const tipo of order) {
    const a = items.find((x) => x.tipo === tipo);
    if (a && out.length < cap) out.push(a);
  }
  if (rec) out.push(rec);
  return out;
}

export function buildAchados(input: {
  tab: InsightTab;
  metric: MetricKey;
  totals?: TotalsLite | null;
  previous?: TotalsLite | null;
  campanhas?: NamedRow[];
  demografia?: DemoRow[];
  regioes?: GeoRow[];
}): Achado[] {
  if (input.tab === 'demografia') return demoAchados(input.demografia ?? [], input.metric).slice(0, MAX);
  if (input.tab === 'regiao') return geoAchados(input.regioes ?? [], input.metric).slice(0, MAX);
  return pick(campanhaAchados(input.campanhas ?? [], input.totals ?? null, input.previous ?? null, input.metric));
}

function campanhaAchados(
  rows: NamedRow[], totals: TotalsLite | null, previous: TotalsLite | null, metric: MetricKey,
): Achado[] {
  if (!totals || !rows.length) return [];
  const out: Achado[] = [];
  const label = METRICS[metric].label.toLowerCase();
  const plats = sumPlatforms(rows);
  const relevantes = plats.filter((r) => r.impressions >= PISO && r.cost > 0);

  if (previous) {
    const nowV = metricValue(totals, metric);
    const beforeV = metricValue(previous, metric);
    const d = deltaPct(nowV, beforeV);
    if (beforeV === 0 || (d != null && Math.abs(d) > 1000)) {
      out.push({
        tipo: 'anomalia',
        frase: `${METRICS[metric].label} saiu de ${compact(beforeV)} para ${compact(nowV)} — a janela anterior quase não reportava essa métrica, não leia como crescimento de audiência.`,
      });
    }

    const dImp = deltaPct(totals.impressions, previous.impressions);
    const dCost = deltaPct(totals.cost, previous.cost);
    const cpmN = cpmOf(totals), cpmP = cpmOf(previous);
    const tensed = dImp != null && dCost != null && Math.abs(dImp) >= 15
      && cpmP > 0 && (cpmN > cpmP * 1.1 || cpmN < cpmP * 0.9);
    if (tensed && dImp != null && dCost != null) {
      const piorou = cpmN > cpmP;
      out.push({
        tipo: 'mix_vs_rate',
        frase: `Impressões ${dImp >= 0 ? 'subiram' : 'caíram'} ${pct(Math.abs(dImp))} (${compact(previous.impressions)} → ${compact(totals.impressions)}), mas o investimento ${dCost >= 0 ? 'subiu' : 'caiu'} ${pct(Math.abs(dCost))} — o CPM foi de ${brl(cpmP)} para ${brl(cpmN)}${piorou ? ', eficiência pior' : ', eficiência melhor'}.`,
      });
    }
  }

  const totalM = metricValue(totals, metric);
  if (METRICS[metric].kind === 'count') {
    const best = [...rows].sort((a, b) => metricValue(b, metric) - metricValue(a, metric))[0];
    if (best && totalM) {
      const unit = unitOf(best, metric);
      const extra = unit ? `, ${unit.label} ${brl(unit.value)}` : '';
      out.push({
        tipo: 'lider',
        frase: `${shortCampaignName(best.nome)} (${platformLabel(best.platform)}) lidera em ${label}: ${compact(metricValue(best, metric))} (${pct(div(metricValue(best, metric), totalM) * 100)} do recorte)${extra}.`,
      });
    }
  } else {
    // Razão: menor é melhor para custo-por-X (currency), maior para taxa (pct).
    const menorMelhor = METRICS[metric].kind === 'currency';
    const ranked = relevantes
      .map((r) => ({ r, v: metricValue(r, metric) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => (menorMelhor ? a.v - b.v : b.v - a.v));
    if (ranked.length >= 2 && Number.isFinite(totalM)) {
      const b = ranked[0]!;
      out.push({
        tipo: 'lider',
        frase: `${b.r.nome} tem o ${menorMelhor ? 'menor' : 'maior'} ${label} do recorte: ${fmtM(b.v, metric)} (média ${fmtM(totalM, metric)}).`,
      });
    }
  }

  if (relevantes.length >= 2 && totals.clicks > 0) {
    const ranked = [...relevantes]
      .map((r) => ({
        r,
        clickShare: div(r.clicks, totals.clicks),
        spendShare: div(r.cost, totals.cost),
        ctr: ctrOf(r),
      }))
      .filter((x) => x.clickShare >= 0.15 && x.spendShare > 0 && x.clickShare / x.spendShare >= 3)
      .sort((a, b) => b.clickShare / b.spendShare - a.clickShare / a.spendShare);
    const top = ranked[0];
    if (top) {
      out.push({
        tipo: 'outlier',
        frase: `${platformLabel(top.r.platform)} concentra ${pct(top.clickShare * 100)} dos cliques com ${pct(top.spendShare * 100)} do gasto (CTR ${pct(top.ctr, 2)} vs ${pct(ctrOf(totals), 2)} do recorte).`,
      });
    }
  }

  if (relevantes.length >= 2) {
    const cpms = relevantes.map(cpmOf).filter((v) => v > 0);
    const med = median(cpms);
    const caro = [...relevantes].sort((a, b) => cpmOf(b) - cpmOf(a))[0];
    if (caro && med && cpmOf(caro) >= med * 3) {
      out.push({
        tipo: 'outlier',
        frase: `${platformLabel(caro.platform)} entrega a CPM ${brl(cpmOf(caro))} (${nf(cpmOf(caro) / med, 1)}× a mediana do recorte).`,
      });
    }
  }

  const zeroClick = relevantes.filter((r) => r.clicks === 0);
  if (zeroClick.length) {
    const names = zeroClick.map((r) => platformLabel(r.platform)).join(', ');
    out.push({
      tipo: 'caveat',
      frase: `${names} ${zeroClick.length > 1 ? 'somam gasto sem cliques reportados' : 'gasta sem cliques reportados'} — zero clique aqui é ausência de métrica, não fracasso.`,
    });
  }

  if ((metric === 'impressoes' || metric === 'alcance' || metric === 'investimento')
    && totals.reach > 0 && totals.impressions / totals.reach >= 6) {
    out.push({
      tipo: 'caveat',
      frase: `Frequência média de ${nf(div(totals.impressions, totals.reach), 1)} — cada pessoa alcançada viu o anúncio esse número de vezes.`,
    });
  }

  if (totals.impressions && !totals.engagement) {
    out.push({
      tipo: 'caveat',
      frase: 'Nenhuma interação social no recorte: as plataformas presentes não reportam curtidas, comentários ou compartilhamentos.',
    });
  }

  if (totals.clicks >= 100 && relevantes.length >= 2) {
    const efficient = relevantes.filter((r) =>
      div(r.clicks, totals.clicks) >= 0.15 && div(r.cost, totals.cost) < 0.15);
    const volume = relevantes.filter((r) =>
      div(r.cost, totals.cost) >= 0.2 && div(r.clicks, totals.clicks) < 0.1);
    if (efficient.length && volume.length) {
      const names = (rs: NamedRow[]) => {
        const n = rs.map((r) => platformLabel(r.platform));
        return n.length <= 2 ? n.join(' e ') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
      };
      out.push({
        tipo: 'recomendacao',
        frase: `Se o objetivo for tráfego, ${names(efficient)} já levam a maior parte dos cliques com pouco gasto — avaliar reforço. ${names(volume)} puxam volume, não clique.`,
      });
    }
  }

  return out;
}

function demoAchados(rows: DemoRow[], metric: MetricKey): Achado[] {
  if (!rows.length) return [];
  const out: Achado[] = [];
  const label = METRICS[metric].label.toLowerCase();

  // Métrica de razão: "X% do total" não faz sentido — só magnitude por fatia.
  if (METRICS[metric].kind !== 'count') {
    const known = (v: DemoRow) => v.faixa !== 'n/d';
    const faixas = AGE_ORDER.filter((f) => f !== 'n/d')
      .map((f) => ({ f, v: aggMetric(rows.filter((r) => r.faixa === f && known(r)), metric) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => b.v - a.v);
    if (faixas.length >= 2) {
      const hi = faixas[0]!, lo = faixas[faixas.length - 1]!;
      out.push({
        tipo: 'lider',
        frase: `${label} varia por faixa: ${hi.f} tem o maior (${fmtM(hi.v, metric)}) e ${lo.f} o menor (${fmtM(lo.v, metric)}).`,
      });
    }
    const byG = GENDERS
      .map((g) => ({ g, v: aggMetric(rows.filter((r) => r.gender === g), metric) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => b.v - a.v);
    if (byG.length >= 2 && byG[0]!.v > byG[byG.length - 1]!.v * 1.15) {
      const hi = byG[0]!;
      out.push({
        tipo: 'outlier',
        frase: `Por gênero, ${GENDER_LABEL[hi.g] ?? hi.g} puxa o ${label} mais alto (${fmtM(hi.v, metric)}).`,
      });
    }
    return out;
  }

  const total = rows.reduce((s, r) => s + metricValue(r, metric), 0);
  for (const g of GENDERS) {
    const v = rows.filter((r) => r.gender === g).reduce((s, r) => s + metricValue(r, metric), 0);
    if (total && v / total > 0.5) {
      out.push({
        tipo: 'lider',
        frase: `${GENDER_LABEL[g] ?? g} responde por ${pct(div(v, total) * 100, 1)} de ${label} — mais da metade do recorte.`,
      });
    }
  }
  const byFaixa = AGE_ORDER.map((f) => ({
    f, v: rows.filter((r) => r.faixa === f).reduce((s, r) => s + metricValue(r, metric), 0),
  }));
  const topF = [...byFaixa].sort((a, b) => b.v - a.v)[0];
  if (topF && total) {
    out.push({
      tipo: 'lider',
      frase: `A maior faixa isolada é ${topF.f}, com ${pct(div(topF.v, total) * 100, 1)} do total.`,
    });
  }
  const nd = byFaixa.find((x) => x.f === 'n/d');
  if (nd && total && nd.v / total > 0.05) {
    out.push({
      tipo: 'caveat',
      frase: `${pct(div(nd.v, total) * 100, 1)} da entrega chega sem faixa etária identificada.`,
    });
  }
  return out;
}

function geoAchados(rows: GeoRow[], metric: MetricKey): Achado[] {
  if (!rows.length) return [];
  const out: Achado[] = [];
  const label = METRICS[metric].label.toLowerCase();

  // Métrica de razão: por UF cada linha já é um agregado — magnitude, não "% do total".
  if (METRICS[metric].kind !== 'count') {
    const ranked = rows
      .map((r) => ({ r, v: metricValue(r, metric) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => b.v - a.v);
    if (ranked.length >= 2) {
      const hi = ranked[0]!, lo = ranked[ranked.length - 1]!;
      out.push({
        tipo: 'lider',
        frase: `${hi.r.estado} tem o maior ${label} (${fmtM(hi.v, metric)}) e ${lo.r.estado} o menor (${fmtM(lo.v, metric)}), entre ${ranked.length} UFs.`,
      });
    }
    return out;
  }

  const sorted = [...rows].sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
  const total = sorted.reduce((s, r) => s + metricValue(r, metric), 0);
  const top = sorted[0];
  if (top && total) {
    out.push({
      tipo: 'lider',
      frase: `${top.estado} lidera com ${pct(div(metricValue(top, metric), total) * 100, 1)} do total.`,
    });
  }
  const ne = sorted.filter((r) => NE.includes(r.uf)).reduce((s, r) => s + metricValue(r, metric), 0);
  if (total) {
    out.push({
      tipo: 'outlier',
      frase: `O Nordeste somado responde por ${pct(div(ne, total) * 100, 1)}, distribuído em ${sorted.filter((r) => NE.includes(r.uf)).length} UFs.`,
    });
  }
  const bottom = sorted.slice(-5);
  if (total && bottom.length === 5) {
    out.push({
      tipo: 'caveat',
      frase: `As cinco UFs com menor entrega (${bottom.map((r) => r.uf).join(', ')}) somam ${pct(div(bottom.reduce((s, r) => s + metricValue(r, metric), 0), total) * 100, 1)}.`,
    });
  }
  return out;
}
