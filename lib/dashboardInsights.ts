// Achados da leitura do dashboard. Tudo é puro: o cliente mostra as frases
// como fallback e a rota de insights só pede ao modelo que as redija.
// Números vêm de somas (nunca média de taxas). Piso de 10 mil impressões
// para falar de eficiência — o mesmo do fallback antigo.
//
// Campanhas lê em blocos: tendência (vs janela anterior) → último dia →
// plataformas → campanhas → anúncios → recomendação. Eficiência é sempre o
// custo unitário da métrica ativa (CPC, CPV, CPE, CPM); o "índice" é a razão
// entre a fatia da métrica e a fatia do gasto (1,0× = proporcional).

import {
  AGE_ORDER, GENDER_LABEL, GENDERS, METRICS, networkLabel, platformLabel,
  type MetricKey,
} from '@/lib/dashboard';

export type InsightTab = 'campanhas' | 'demografia' | 'regiao';
export type AchadoTipo =
  | 'lider' | 'mix_vs_rate' | 'outlier' | 'anomalia' | 'caveat' | 'recomendacao';
export type Bloco =
  | 'tendencia' | 'dia' | 'referencia' | 'plataformas' | 'redes' | 'campanhas' | 'anuncios'
  | 'distribuicao' | 'eficiencia' | 'cobertura' | 'recomendacao';
export type Achado = { tipo: AchadoTipo; bloco: Bloco; frase: string };

/** Ordem de exibição e rótulo HUD de cada bloco. */
export const BLOCOS: Record<Bloco, string> = {
  tendencia: 'Tendência',
  dia: 'Último dia',
  referencia: 'Referência',
  plataformas: 'Plataformas',
  redes: 'Redes',
  campanhas: 'Campanhas',
  anuncios: 'Anúncios',
  distribuicao: 'Distribuição',
  eficiencia: 'Eficiência',
  cobertura: 'Cobertura',
  recomendacao: 'Recomendação',
};
const ORDEM = Object.keys(BLOCOS) as Bloco[];

export type TotalsLite = {
  cost: number; impressions: number; reach: number;
  clicks: number; videoViews: number; engagement: number;
};
export type NamedRow = TotalsLite & { nome: string; platform: string };
export type PlatformRow = TotalsLite & { platform: string };
export type RedeRow = PlatformRow & { network: string };
/** Foco: exatamente uma campanha (grupo) ou uma plataforma filtrada; `porPlataforma` é o
 *  mesmo recorte sem esse filtro — o foco é subtraído para comparar com "as demais". */
export type Referencia = { foco: 'campanha' | 'plataforma'; nome: string; porPlataforma: PlatformRow[] };
export type DailyRow = TotalsLite & { date: string };
export type DemoRow = TotalsLite & { faixa: string; gender: string };
export type GeoRow = TotalsLite & { uf: string; estado: string };

const PISO = 10_000;
const MAX = 9;
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
/** Fatia em %: abaixo de 1% ganha uma casa, para 0,4% não virar "0%". */
const fatia = (v: number) => pct(v, v > 0 && v < 1 ? 1 : 0);
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${pct(Math.abs(v))}`;
const vx = (v: number) => `${nf(v, v >= 10 ? 0 : 1)}×`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

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

const ZERO: TotalsLite = { cost: 0, impressions: 0, reach: 0, clicks: 0, videoViews: 0, engagement: 0 };
const add = (a: TotalsLite, r: TotalsLite): TotalsLite => ({
  cost: a.cost + r.cost, impressions: a.impressions + r.impressions, reach: a.reach + r.reach,
  clicks: a.clicks + r.clicks, videoViews: a.videoViews + r.videoViews, engagement: a.engagement + r.engagement,
});
const sum = (rows: TotalsLite[]) => rows.reduce(add, ZERO);

/** Volume (soma) ou razão sobre as somas — nunca média de taxas. */
const isVolume = (m: MetricKey) =>
  m === 'investimento' || METRICS[m].kind === 'count';
const aggMetric = (rows: TotalsLite[], m: MetricKey) =>
  isVolume(m) ? rows.reduce((s, r) => s + metricValue(r, m), 0) : metricValue(sum(rows), m);

const fmtM = (v: number, m: MetricKey) =>
  !Number.isFinite(v) ? '—'
    : METRICS[m].kind === 'currency' && m !== 'investimento' ? brl(v)
    : m === 'investimento' ? `R$ ${compact(v)}`
    : METRICS[m].kind === 'pct' ? pct(v, 2)
    : compact(v);

// ── Resultado que a métrica ativa mede e o custo unitário dele ─────────────
type OutKey = 'clicks' | 'videoViews' | 'engagement' | 'impressions' | 'reach';
type Out = { key: OutKey; nome: string; art: 'dos' | 'das'; unit: string; mil: boolean; taxa?: string };
const CLICKS: Out = { key: 'clicks', nome: 'cliques', art: 'dos', unit: 'CPC', mil: false, taxa: 'CTR' };
const VIEWS: Out = { key: 'videoViews', nome: 'visualizações', art: 'das', unit: 'CPV', mil: false, taxa: 'VTR' };
const ENG: Out = { key: 'engagement', nome: 'interações', art: 'das', unit: 'CPE', mil: false, taxa: 'Tx. Eng.' };
const IMP: Out = { key: 'impressions', nome: 'impressões', art: 'das', unit: 'CPM', mil: true };
const REACH: Out = { key: 'reach', nome: 'pessoas alcançadas', art: 'das', unit: 'custo por mil alcançados', mil: true };
const OUT: Record<MetricKey, Out> = {
  cliques: CLICKS, ctr: CLICKS, cpc: CLICKS,
  visualizacoes: VIEWS, vtr: VIEWS, cpv: VIEWS,
  engajamento: ENG, tx_eng: ENG, cpe: ENG,
  impressoes: IMP, investimento: IMP, alcance: REACH,
};
/** Métricas-taxa: maior é melhor e a comparação é a própria taxa, não custo. */
const isRate = (m: MetricKey) => METRICS[m].kind === 'pct';

const unitCost = (t: TotalsLite, o: Out) =>
  t[o.key] ? (t.cost / t[o.key]) * (o.mil ? 1000 : 1) : NaN;
/** Fatia da métrica ÷ fatia do gasto (= custo unitário do recorte ÷ o da linha). */
const indice = (t: TotalsLite, tot: TotalsLite, o: Out) => div(unitCost(tot, o), unitCost(t, o));
/** Taxa por impressão (CTR/VTR/Tx. Eng.) em %. */
const taxa = (t: TotalsLite, o: Out) => div(t[o.key], t.impressions) * 100;

/** Mais cliques ou views do que impressões é dado inconsistente (GloboAds reporta VTR > 100%)
 *  — a linha sai de todo ranking e de toda recomendação. */
const consistente = (t: TotalsLite, o: Out) =>
  (o.key !== 'clicks' && o.key !== 'videoViews') || t[o.key] <= t.impressions;

/** Quantidade comparável entre linhas e se maior é melhor. */
function score(m: MetricKey): { q: (t: TotalsLite) => number; maior: boolean; fmt: (v: number) => string; nome: string } {
  const o = OUT[m];
  if (isRate(m)) return { q: (t) => (consistente(t, o) ? metricValue(t, m) : NaN), maior: true, fmt: (v) => pct(v, 2), nome: METRICS[m].label };
  return { q: (t) => (consistente(t, o) ? unitCost(t, o) : NaN), maior: false, fmt: brl, nome: o.unit };
}

/** Trecho entre o 1º e o 2º "|" — mesma regra de fallback dos grupos. */
export function shortCampaignName(nome: string): string {
  const parts = nome.split('|').map((s) => s.trim()).filter(Boolean);
  const raw = parts.length >= 2 ? parts[1] : nome;
  return raw.length > 64 ? raw.slice(0, 63) + '…' : raw;
}
const shortAd = (nome: string) => (nome.length > 56 ? nome.slice(0, 55) + '…' : nome);

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
const deltaPct = (now: number, before: number) =>
  before && Number.isFinite(now) && Number.isFinite(before) ? ((now - before) / before) * 100 : null;
/** Base zero ou salto >1000%: cobertura mudou, não é tendência. */
const semBase = (now: number, before: number) => {
  if (!Number.isFinite(before) || before === 0) return Number.isFinite(now) && now !== 0;
  const d = deltaPct(now, before);
  return d != null && Math.abs(d) > 1000;
};

function sumPlatforms(rows: NamedRow[]): NamedRow[] {
  const map = new Map<string, NamedRow>();
  for (const r of rows) {
    const cur = map.get(r.platform);
    map.set(r.platform, cur
      ? { ...cur, ...add(cur, r) }
      : { ...r, nome: platformLabel(r.platform) });
  }
  return [...map.values()];
}

const lista = (n: string[]) =>
  n.length <= 2 ? n.join(' e ') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;

/** Um achado por bloco (o primeiro, em ordem de prioridade), depois completa até MAX; exibe na ordem dos blocos. */
function pick(items: Achado[]): Achado[] {
  const out: Achado[] = [];
  for (const b of ORDEM) {
    const a = items.find((x) => x.bloco === b);
    if (a) out.push(a);
  }
  // Vagas que sobram: recomendação e referência antes dos demais.
  const prioridade = (a: Achado) => (a.bloco === 'recomendacao' ? 0 : a.bloco === 'referencia' ? 1 : 2);
  for (const a of [...items].sort((x, y) => prioridade(x) - prioridade(y)))
    if (out.length < MAX && !out.includes(a)) out.push(a);
  return out
    .slice(0, MAX)
    .sort((a, b) => ORDEM.indexOf(a.bloco) - ORDEM.indexOf(b.bloco));
}

export function buildAchados(input: {
  tab: InsightTab;
  metric: MetricKey;
  totals?: TotalsLite | null;
  previous?: TotalsLite | null;
  previousByPlatform?: PlatformRow[] | null;
  redes?: RedeRow[];
  previousByRede?: RedeRow[] | null;
  referencia?: Referencia | null;
  campanhas?: NamedRow[];
  anuncios?: NamedRow[];
  daily?: DailyRow[];
  gran?: 'dia' | 'semana' | 'mes';
  hoje?: string;
  demografia?: DemoRow[];
  regioes?: GeoRow[];
}): Achado[] {
  if (input.tab === 'demografia') return pick(demoAchados(input.demografia ?? [], input.metric));
  if (input.tab === 'regiao') return pick(geoAchados(input.regioes ?? [], input.metric));
  const { metric } = input;
  const totals = input.totals ?? null;
  const rows = input.campanhas ?? [];
  if (!totals || !rows.length) return [];
  const plats = sumPlatforms(rows);
  const prevPlats = new Map((input.previousByPlatform ?? []).map((p) => [platformLabel(p.platform), p as TotalsLite]));
  // Uma plataforma só (filtro ou dado): a comparação desce para as redes dela.
  const umaPlataforma = plats.length === 1;
  const redes = umaPlataforma ? porRede(input.redes ?? []) : [];
  const prevRedes = new Map(porRede(input.previousByRede ?? []).map((r) => [r.nome, r as TotalsLite]));
  const ads = (input.anuncios ?? []).filter((r) => r.nome);
  return pick([
    ...tendencia(totals, input.previous ?? null, metric),
    ...ultimoDia(input.gran === 'dia' ? input.daily ?? [] : [], metric,
      input.hoje ?? new Date().toISOString().slice(0, 10)),
    ...referencia(input.referencia ?? null, totals, plats, metric),
    ...ranking(plats, totals, prevPlats, metric, 'plataformas'),
    ...ranking(redes, totals, prevRedes, metric, 'redes'),
    ...campanhas(rows, totals, metric),
    ...anuncios(ads, metric),
    ...realocar(umaPlataforma ? redes : plats, totals, metric, { piso: 0.15, frac: 0.1 }),
    ...realocar(ads, sum(ads), metric, { piso: 0.05, frac: 0.2, anuncio: true }),
    ...caveats(plats, totals, metric),
  ]);
}

// ── 1. Tendência: período × janela anterior ────────────────────────────────
function tendencia(totals: TotalsLite, previous: TotalsLite | null, metric: MetricKey): Achado[] {
  if (!previous) return [];
  const out: Achado[] = [];
  const o = OUT[metric];
  const label = METRICS[metric].label;
  const nowV = metricValue(totals, metric), beforeV = metricValue(previous, metric);
  const anomalo = semBase(nowV, beforeV) || semBase(totals[o.key], previous[o.key]);

  if (anomalo) {
    out.push({
      tipo: 'anomalia', bloco: 'tendencia',
      frase: `${label} saiu de ${fmtM(beforeV, metric)} para ${fmtM(nowV, metric)} — a janela anterior quase não reportava essa métrica, não leia como crescimento de audiência.`,
    });
  }

  const dImp = deltaPct(totals.impressions, previous.impressions);
  const dCost = deltaPct(totals.cost, previous.cost);

  // Cliques/views/interações = impressões × taxa: diz qual dos dois puxou.
  if (!anomalo && o.taxa && dImp != null) {
    const dOut = deltaPct(totals[o.key], previous[o.key]);
    const t0 = taxa(previous, o), t1 = taxa(totals, o);
    if (dOut != null && t0 > 0 && t1 > 0) {
      const vol = Math.abs(Math.log(1 + dImp / 100));
      const eff = Math.abs(Math.log(t1 / t0));
      const motor = vol >= eff * 2 ? 'puxado pelo volume de mídia, não por eficiência'
        : eff >= vol * 2 ? `puxado pela ${o.taxa}, não por compra de mídia`
        : 'volume e eficiência contribuíram';
      const u0 = unitCost(previous, o), u1 = unitCost(totals, o);
      const cabeca = isVolume(metric) && metric !== 'investimento'
        ? `${label} ${signed(dOut)} (${compact(previous[o.key])} → ${compact(totals[o.key])})`
        : `${label} foi de ${fmtM(beforeV, metric)} para ${fmtM(nowV, metric)}`;
      out.push({
        tipo: 'mix_vs_rate', bloco: 'tendencia',
        frase: `${cabeca}: impressões ${signed(dImp)} e ${o.taxa} de ${pct(t0, 2)} para ${pct(t1, 2)} — ${motor}${Number.isFinite(u0) && Number.isFinite(u1) ? `; ${o.unit} ${brl(u0)} → ${brl(u1)}` : ''}.`,
      });
      return out;
    }
  }

  // Impressões/alcance/investimento, ou métrica sem base: lê pelo CPM.
  const cpmN = cpmOf(totals), cpmP = cpmOf(previous);
  if (dImp != null && dCost != null && cpmP > 0 && Math.abs(dImp) >= 5) {
    const dCpm = (cpmN / cpmP - 1) * 100;
    const leitura = Math.abs(dCpm) < 5 ? 'eficiência estável'
      : cpmN > cpmP ? 'eficiência pior' : 'eficiência melhor';
    out.push({
      tipo: 'mix_vs_rate', bloco: 'tendencia',
      frase: `Impressões ${dImp >= 0 ? 'subiram' : 'caíram'} ${pct(Math.abs(dImp))} (${compact(previous.impressions)} → ${compact(totals.impressions)}), com investimento ${signed(dCost)} — o CPM foi de ${brl(cpmP)} para ${brl(cpmN)}, ${leitura}.`,
    });
  }
  return out;
}

// ── 2. Último dia × dia anterior e × média da janela ───────────────────────
function ultimoDia(daily: DailyRow[], metric: MetricKey, hoje: string): Achado[] {
  if (daily.length < 3) return [];
  const last = daily[daily.length - 1]!, prev = daily[daily.length - 2]!;
  const outros = daily.slice(0, -1);
  const label = METRICS[metric].label;
  const vLast = metricValue(last, metric), vPrev = metricValue(prev, metric);
  // Média diária: volume = média das somas; razão = razão das somas dos outros dias.
  const vAvg = isVolume(metric) ? aggMetric(outros, metric) / outros.length : aggMetric(outros, metric);
  const ontem = new Date(new Date(hoje + 'T00:00:00Z').getTime() - 86_400_000).toISOString().slice(0, 10);
  const recente = last.date >= ontem;

  if (!last.impressions && prev.impressions) {
    return [{
      tipo: 'caveat', bloco: 'dia',
      frase: `${ddmm(last.date)} ainda sem entrega reportada${recente ? ' — os dados das plataformas chegam com atraso' : ''}.`,
    }];
  }
  if (last.impressions < PISO / 10 && !isVolume(metric)) return [];
  const dPrev = deltaPct(vLast, vPrev), dAvg = deltaPct(vLast, vAvg);
  if (dPrev == null && dAvg == null) return [];
  const forte = Math.max(Math.abs(dPrev ?? 0), Math.abs(dAvg ?? 0)) >= 20;
  const partes = [
    dPrev != null ? `${signed(dPrev)} vs ${ddmm(prev.date)}` : null,
    dAvg != null ? `${signed(dAvg)} vs a média diária do período (${fmtM(vAvg, metric)})` : null,
  ].filter(Boolean).join(' e ');
  const aviso = recente ? ' — dia recente, pode estar incompleto' : '';
  return [{
    tipo: forte ? 'outlier' : 'lider', bloco: 'dia',
    frase: forte
      ? `${ddmm(last.date)} fechou com ${fmtM(vLast, metric)} em ${label.toLowerCase()}: ${partes}${aviso}.`
      : `${ddmm(last.date)} fechou com ${fmtM(vLast, metric)} em ${label.toLowerCase()}, em linha com o período: ${partes}${aviso}.`,
  }];
}

/** Redes da plataforma somadas pelo rótulo (YOUTUBE e YOUTUBE_WATCH são o mesmo YouTube). */
function porRede(rows: RedeRow[]): NamedRow[] {
  const map = new Map<string, NamedRow>();
  for (const r of rows) {
    if (!r.network) continue;
    const nome = networkLabel(r.network);
    const cur = map.get(nome);
    map.set(nome, cur ? { ...cur, ...add(cur, r) } : { ...r, nome });
  }
  return [...map.values()];
}

// ── 3. Plataformas / redes: ranking por custo unitário / taxa ──────────────
function ranking(
  items: NamedRow[], totals: TotalsLite, prev: Map<string, TotalsLite>, metric: MetricKey, bloco: Bloco,
): Achado[] {
  const o = OUT[metric];
  const s = score(metric);
  const ranked = items
    .filter((r) => r.impressions >= PISO && r.cost > 0 && r[o.key] > 0)
    .map((r) => ({ r, v: s.q(r) }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => (s.maior ? b.v - a.v : a.v - b.v));
  if (ranked.length < 2) return [];
  const best = ranked[0]!, worst = ranked[ranked.length - 1]!;
  const share = (r: TotalsLite) => fatia(div(r[o.key], totals[o.key]) * 100);
  const gasto = (r: TotalsLite) => fatia(div(r.cost, totals.cost) * 100);
  const media = s.q(totals);

  // Δ do melhor vs janela anterior, quando ele já entregava antes.
  let delta = '';
  const p = prev.get(best.r.nome);
  if (p) {
    const before = s.q(p);
    if (Number.isFinite(before) && !semBase(best.v, before)) {
      const d = deltaPct(best.v, before);
      if (d != null && Math.abs(d) >= 5) delta = ` (era ${s.fmt(before)} na janela anterior)`;
    }
  }

  const frase = isRate(metric)
    ? `${best.r.nome} tem o maior ${s.nome} (${s.fmt(best.v)})${delta} e ${worst.r.nome} o menor (${s.fmt(worst.v)}); média do recorte ${s.fmt(media)}.`
    : `${best.r.nome} entrega ${share(best.r)} ${o.art} ${o.nome} com ${gasto(best.r)} do gasto — ${o.unit} ${s.fmt(best.v)}${delta}, ${vx(indice(best.r, totals, o))} a eficiência média. ${worst.r.nome} fica com ${gasto(worst.r)} do gasto e ${share(worst.r)} ${o.art} ${o.nome} (${o.unit} ${s.fmt(worst.v)}).`;
  return [{ tipo: 'lider', bloco, frase }];
}

// ── Referência: o foco contra o mesmo recorte sem o filtro dele ────────────
function referencia(ref: Referencia | null, totals: TotalsLite, plats: NamedRow[], metric: MetricKey): Achado[] {
  if (!ref) return [];
  const o = OUT[metric];
  const s = score(metric);
  const tudo = sum(ref.porPlataforma);
  const menos = (a: TotalsLite, b: TotalsLite): TotalsLite => ({
    cost: Math.max(0, a.cost - b.cost), impressions: Math.max(0, a.impressions - b.impressions),
    reach: Math.max(0, a.reach - b.reach), clicks: Math.max(0, a.clicks - b.clicks),
    videoViews: Math.max(0, a.videoViews - b.videoViews), engagement: Math.max(0, a.engagement - b.engagement),
  });
  const demais = menos(tudo, totals);
  const nome = ref.foco === 'campanha' ? ref.nome : platformLabel(ref.nome);
  const grupo = ref.foco === 'campanha' ? 'das demais campanhas' : 'das demais plataformas';
  const vF = s.q(totals), vD = s.q(demais);
  if (!Number.isFinite(vF) || !Number.isFinite(vD) || vD <= 0 || vF <= 0 || demais.impressions < PISO) return [];

  const vezes = s.maior ? vF / vD : vD / vF;
  const sentido = vezes >= 1.1 ? `${vx(vezes)} mais eficiente` : vezes <= 0.9 ? `${vx(1 / vezes)} menos eficiente` : 'em linha';
  const peso = isVolume(metric) && metric !== 'investimento'
    ? ` Responde por ${fatia(div(totals[o.key], tudo[o.key]) * 100)} ${o.art} ${o.nome} do recorte com ${fatia(div(totals.cost, tudo.cost) * 100)} do gasto.`
    : '';

  // Campanha: compara também dentro de uma plataforma — a de maior gasto em que as outras
  // campanhas têm a métrica (na GloboAds elas costumam vir sem clique, sem base de comparação).
  let dentro = '';
  if (ref.foco === 'campanha') {
    for (const principal of [...plats].sort((a, b) => b.cost - a.cost)) {
      const refP = ref.porPlataforma.find((p) => p.platform === principal.platform);
      if (!refP) continue;
      const outrasP = menos(refP, principal);
      const a = s.q(principal), b = s.q(outrasP);
      if (Number.isFinite(a) && Number.isFinite(b) && b > 0 && outrasP.impressions >= PISO) {
        dentro = ` No ${principal.nome}, ${s.fmt(a)} contra ${s.fmt(b)} das outras campanhas da plataforma.`;
        break;
      }
    }
  }
  // Dois achados: a IA redige um por frase, e fundidos ela descartava a comparação interna.
  return [{
    tipo: vezes >= 1.5 || vezes <= 0.67 ? 'outlier' : 'lider', bloco: 'referencia',
    frase: `${nome}: ${s.nome} ${s.fmt(vF)} contra ${s.fmt(vD)} ${grupo} no mesmo recorte — ${sentido}.${peso} Objetivos diferentes pesam nessa comparação.`,
  }, ...(dentro ? [{ tipo: 'lider' as const, bloco: 'referencia' as const, frase: dentro.trim() }] : [])];
}

// ── 4. Campanhas: líder, concentração e a mais eficiente com volume ────────
function campanhas(rows: NamedRow[], totals: TotalsLite, metric: MetricKey): Achado[] {
  const out: Achado[] = [];
  const o = OUT[metric];
  const label = METRICS[metric].label.toLowerCase();
  const nome = (r: NamedRow) => `${shortCampaignName(r.nome)} (${platformLabel(r.platform)})`;

  if (isVolume(metric)) {
    const totalM = metricValue(totals, metric);
    const sorted = [...rows].sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
    const best = sorted[0];
    if (best && totalM) {
      const top3 = sorted.slice(0, 3).reduce((acc, r) => acc + metricValue(r, metric), 0);
      const u = unitCost(best, o);
      const extra = metric !== 'investimento' && Number.isFinite(u) ? `, ${o.unit} ${brl(u)}` : '';
      const conc = sorted.length > 3 ? `; as 3 maiores somam ${pct(div(top3, totalM) * 100)}` : '';
      out.push({
        tipo: 'lider', bloco: 'campanhas',
        frase: `${nome(best)} lidera em ${label}: ${fmtM(metricValue(best, metric), metric)} (${pct(div(metricValue(best, metric), totalM) * 100)} do recorte${extra})${conc}.`,
      });
    }
  }

  // Acima da curva: melhor custo unitário/taxa entre campanhas com volume relevante.
  const s = score(metric);
  const relevantes = rows
    .filter((r) => r.impressions >= PISO * 10 && r[o.key] > 0 && r.cost > 0)
    .map((r) => ({ r, v: s.q(r) }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => (s.maior ? b.v - a.v : a.v - b.v));
  const media = s.q(totals);
  // Plataforma de uma campanha só já foi dita no bloco Plataformas.
  const top = relevantes.find((x) => rows.filter((r) => r.platform === x.r.platform).length > 1);
  if (top && relevantes.length >= 2 && Number.isFinite(media) && media > 0) {
    const vezes = s.maior ? top.v / media : media / top.v;
    if (vezes >= 1.5) {
      out.push({
        tipo: 'outlier', bloco: 'campanhas',
        frase: `${nome(top.r)} é a mais eficiente com volume: ${s.nome} ${s.fmt(top.v)} contra ${s.fmt(media)} do recorte (${vx(vezes)} melhor).`,
      });
    }
  }
  return out;
}

// ── 5. Anúncios: melhor criativo × pior com gasto relevante ────────────────
function anuncios(ads: NamedRow[], metric: MetricKey): Achado[] {
  const o = OUT[metric];
  const s = score(metric);
  const gastoAds = ads.reduce((acc, r) => acc + r.cost, 0);
  const ranked = ads
    .filter((r) => r.impressions >= PISO && r.cost > 0 && r[o.key] > 0 && r.nome)
    .map((r) => ({ r, v: s.q(r) }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => (s.maior ? b.v - a.v : a.v - b.v));
  if (ranked.length < 2) return [];
  const best = ranked[0]!;
  const caros = ranked.filter((x) => div(x.r.cost, gastoAds) >= 0.05 && x !== best);
  const worst = caros[caros.length - 1];
  const nome = (r: NamedRow) => `"${shortAd(r.nome)}" (${platformLabel(r.platform)})`;
  if (!worst) {
    return [{
      tipo: 'lider', bloco: 'anuncios',
      frase: `O anúncio mais eficiente é ${nome(best.r)}: ${s.nome} ${s.fmt(best.v)}.`,
    }];
  }
  const vezes = s.maior ? best.v / worst.v : worst.v / best.v;
  return [{
    tipo: vezes >= 2 ? 'outlier' : 'lider', bloco: 'anuncios',
    frase: `Melhor anúncio: ${nome(best.r)}, ${s.nome} ${s.fmt(best.v)}. Entre os de gasto relevante, ${nome(worst.r)} fica em ${s.fmt(worst.v)} (${vx(vezes)} ${s.maior ? 'abaixo' : 'mais caro'}, ${pct(div(worst.r.cost, gastoAds) * 100)} do gasto dos anúncios).`,
  }];
}

// ── 6. Recomendação: realocação, estimativa linear ─────────────────────────
/** Do pior (com ao menos `piso` do gasto) para o mais eficiente, quando o custo unitário
 *  do pior é ao menos o dobro. Plataformas, redes ou anúncios — o mesmo cálculo. */
function realocar(
  items: NamedRow[], totals: TotalsLite, metric: MetricKey,
  opt: { piso: number; frac: number; anuncio?: boolean },
): Achado[] {
  if (metric === 'investimento') return [];
  const o = OUT[metric];
  const rel = items.filter((r) => r.impressions >= PISO && r.cost > 0 && r[o.key] > 0 && consistente(r, o));
  if (rel.length < 2) return [];
  const byIdx = [...rel].sort((a, b) => indice(b, totals, o) - indice(a, totals, o));
  const best = byIdx[0]!;
  const worst = [...byIdx].reverse().find((r) => div(r.cost, totals.cost) >= opt.piso && r !== best);
  if (!worst) return [];
  const uB = unitCost(best, o), uW = unitCost(worst, o);
  if (!(uW >= uB * 2)) return [];
  const verba = worst.cost * opt.frac;
  const ganho = verba * ((o.mil ? 1000 : 1) / uB - (o.mil ? 1000 : 1) / uW);
  return [{
    tipo: 'recomendacao', bloco: 'recomendacao',
    frase: opt.anuncio
      ? `Estimativa linear: mover ${pct(opt.frac * 100)} do gasto do anúncio "${shortAd(worst.nome)}" (${brl(verba)}) para "${shortAd(best.nome)}" renderia ~+${compact(ganho)} ${o.nome} (${o.unit} ${brl(uW)} vs ${brl(uB)}) — escalar o mais eficiente e revisar o criativo do outro.`
      : `Estimativa linear: mover ${pct(opt.frac * 100)} do gasto de ${worst.nome} (${brl(verba)}) para ${best.nome} renderia ~+${compact(ganho)} ${o.nome} (${o.unit} ${brl(uW)} vs ${brl(uB)}) — vale só se os dois servirem ao mesmo objetivo de campanha.`,
  }];
}

// ── Ressalvas de cobertura (preenchem vaga se sobrar) ──────────────────────
function caveats(plats: NamedRow[], totals: TotalsLite, metric: MetricKey): Achado[] {
  const out: Achado[] = [];
  const o = OUT[metric];
  if (o.key !== 'impressions' && o.key !== 'reach') {
    const zero = plats.filter((r) => r.impressions >= PISO && r.cost > 0 && r[o.key] === 0);
    if (zero.length) {
      out.push({
        tipo: 'caveat', bloco: 'plataformas',
        frase: `${lista(zero.map((r) => r.nome))} ${zero.length > 1 ? 'somam' : 'tem'} gasto sem ${o.nome} reportados — zero aqui é ausência de métrica, não fracasso.`,
      });
    }
  }
  if ((metric === 'impressoes' || metric === 'alcance' || metric === 'investimento')
    && totals.reach > 0 && totals.impressions / totals.reach >= 6) {
    out.push({
      tipo: 'caveat', bloco: 'tendencia',
      frase: `Frequência média de ${nf(div(totals.impressions, totals.reach), 1)} — cada pessoa alcançada viu o anúncio esse número de vezes.`,
    });
  }
  if (totals.impressions && !totals.engagement && o.key === 'engagement') {
    out.push({
      tipo: 'caveat', bloco: 'plataformas',
      frase: 'Nenhuma interação social no recorte: as plataformas presentes não reportam curtidas, comentários ou compartilhamentos.',
    });
  }
  return out;
}

// ── Fatias (demografia / região): índice de eficiência por fatia ───────────
function eficienciaFatias(fatias: { nome: string; t: TotalsLite }[], metric: MetricKey): Achado[] {
  if (metric === 'investimento') return [];
  const o = OUT[metric];
  const tot = sum(fatias.map((f) => f.t));
  const rel = fatias
    .filter((f) => div(f.t.cost, tot.cost) >= 0.05 && f.t[o.key] > 0)
    .map((f) => ({ ...f, i: indice(f.t, tot, o) }))
    .sort((a, b) => b.i - a.i);
  if (rel.length < 2) return [];
  const hi = rel[0]!, lo = rel[rel.length - 1]!;
  if (hi.i < lo.i * 1.3) return [];
  const share = (t: TotalsLite) => fatia(div(t[o.key], tot[o.key]) * 100);
  const gasto = (t: TotalsLite) => fatia(div(t.cost, tot.cost) * 100);
  return [{
    tipo: 'outlier', bloco: 'eficiencia',
    frase: `${hi.nome} rende mais por real: ${share(hi.t)} ${o.art} ${o.nome} com ${gasto(hi.t)} do gasto (${o.unit} ${brl(unitCost(hi.t, o))}); ${lo.nome} fica em ${o.unit} ${brl(unitCost(lo.t, o))}.`,
  }];
}

function demoAchados(rows: DemoRow[], metric: MetricKey): Achado[] {
  if (!rows.length) return [];
  const out: Achado[] = [];
  const label = METRICS[metric].label.toLowerCase();
  const porFaixa = AGE_ORDER.filter((f) => f !== 'n/d')
    .map((f) => ({ nome: f, t: sum(rows.filter((r) => r.faixa === f)) }));

  // Métrica de razão: "X% do total" não faz sentido — só magnitude por fatia.
  if (!isVolume(metric)) {
    const faixas = porFaixa
      .map((x) => ({ f: x.nome, v: metricValue(x.t, metric) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => b.v - a.v);
    if (faixas.length >= 2) {
      const hi = faixas[0]!, lo = faixas[faixas.length - 1]!;
      out.push({
        tipo: 'lider', bloco: 'distribuicao',
        frase: `${METRICS[metric].label} varia por faixa: ${hi.f} tem o maior (${fmtM(hi.v, metric)}) e ${lo.f} o menor (${fmtM(lo.v, metric)}).`,
      });
    }
    const byG = GENDERS
      .map((g) => ({ g, v: aggMetric(rows.filter((r) => r.gender === g), metric) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => b.v - a.v);
    if (byG.length >= 2 && byG[0]!.v > byG[byG.length - 1]!.v * 1.15) {
      const hi = byG[0]!;
      out.push({
        tipo: 'outlier', bloco: 'eficiencia',
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
        tipo: 'lider', bloco: 'distribuicao',
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
      tipo: 'lider', bloco: 'distribuicao',
      frase: `A maior faixa isolada é ${topF.f}, com ${pct(div(topF.v, total) * 100, 1)} do total.`,
    });
  }
  out.push(...eficienciaFatias(porFaixa, metric));
  const nd = byFaixa.find((x) => x.f === 'n/d');
  if (nd && total && nd.v / total > 0.05) {
    out.push({
      tipo: 'caveat', bloco: 'cobertura',
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
  if (!isVolume(metric)) {
    const ranked = rows
      .filter((r) => r.impressions >= PISO)
      .map((r) => ({ r, v: metricValue(r, metric) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => b.v - a.v);
    if (ranked.length >= 2) {
      const hi = ranked[0]!, lo = ranked[ranked.length - 1]!;
      out.push({
        tipo: 'lider', bloco: 'distribuicao',
        frase: `${hi.r.estado} tem o maior ${label} (${fmtM(hi.v, metric)}) e ${lo.r.estado} o menor (${fmtM(lo.v, metric)}), entre ${ranked.length} UFs com volume.`,
      });
    }
    return out;
  }

  const sorted = [...rows].sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
  const total = sorted.reduce((s, r) => s + metricValue(r, metric), 0);
  const top = sorted[0];
  if (top && total) {
    const top3 = sorted.slice(0, 3).reduce((s, r) => s + metricValue(r, metric), 0);
    out.push({
      tipo: 'lider', bloco: 'distribuicao',
      frase: `${top.estado} lidera com ${pct(div(metricValue(top, metric), total) * 100, 1)} do total; as 3 maiores UFs somam ${pct(div(top3, total) * 100, 1)}.`,
    });
  }
  out.push(...eficienciaFatias(rows.map((r) => ({ nome: r.estado, t: r })), metric));
  const ne = sorted.filter((r) => NE.includes(r.uf)).reduce((s, r) => s + metricValue(r, metric), 0);
  if (total) {
    out.push({
      tipo: 'outlier', bloco: 'distribuicao',
      frase: `O Nordeste somado responde por ${pct(div(ne, total) * 100, 1)}, distribuído em ${sorted.filter((r) => NE.includes(r.uf)).length} UFs.`,
    });
  }
  return out;
}
