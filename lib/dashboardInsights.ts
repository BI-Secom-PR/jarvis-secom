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
  AGE_ORDER, GENDER_LABEL, GENDERS, MACRO_BY_UF, METRICS, networkLabel, platformLabel, POP_BY_UF, UF_BY_NAME,
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
export type DemoRow = TotalsLite & { faixa: string; gender: string; platform?: string };
export type GeoRow = TotalsLite & { uf: string | null; estado: string; platform?: string };
/** Entrega por faixa × gênero junto do público-alvo declarado no nome da campanha
 *  (`target_age` '18+' | '25 A 44', `target_gender` AS | H | M, ambos podem ser nulos). */
export type AlvoRow = TotalsLite & {
  targetAge: string | null; targetGender: string | null; faixa: string; gender: string;
};
/** Foco das abas dimensionais: o mesmo critério de Campanhas (1 campanha, senão 1 plataforma). */
export type FocoDim = { foco: 'campanha' | 'plataforma'; nome: string };

const PISO = 10_000;
const MAX = 9;

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
/** a − b, sem negativos (o foco está dentro do recorte de referência). */
const menos = (a: TotalsLite, b: TotalsLite): TotalsLite => ({
  cost: Math.max(0, a.cost - b.cost), impressions: Math.max(0, a.impressions - b.impressions),
  reach: Math.max(0, a.reach - b.reach), clicks: Math.max(0, a.clicks - b.clicks),
  videoViews: Math.max(0, a.videoViews - b.videoViews), engagement: Math.max(0, a.engagement - b.engagement),
});

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
  // Abas dimensionais: janela anterior, quebra por plataforma, recorte sem o foco e alvo declarado.
  previousDemografia?: DemoRow[] | null;
  demografiaPlat?: DemoRow[];
  refDemografia?: DemoRow[];
  alvo?: AlvoRow[];
  previousRegioes?: GeoRow[] | null;
  regioesPlat?: GeoRow[];
  refRegioes?: GeoRow[];
  focoDim?: FocoDim | null;
  /** Campanhas do recorte da aba dimensional (top por gasto). */
  campanhasDim?: NamedRow[];
  /** Filtro de rede ligado: nessas abas ele não se aplica (só o Google traz rede). */
  redeFiltrada?: boolean;
}): Achado[] {
  if (input.tab === 'demografia') return pick(demoAchados({
    rows: input.demografia ?? [], previous: input.previousDemografia ?? null, plat: input.demografiaPlat ?? [],
    ref: input.refDemografia ?? [], foco: input.focoDim ?? null, alvo: input.alvo ?? [], camps: input.campanhasDim ?? [],
    redeFiltrada: !!input.redeFiltrada, metric: input.metric,
  }));
  if (input.tab === 'regiao') return pick(geoAchados({
    rows: input.regioes ?? [], previous: input.previousRegioes ?? null, plat: input.regioesPlat ?? [],
    ref: input.refRegioes ?? [], foco: input.focoDim ?? null, camps: input.campanhasDim ?? [],
    redeFiltrada: !!input.redeFiltrada, metric: input.metric,
  }));
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
  opt: { piso: number; frac: number; anuncio?: boolean; publico?: boolean },
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
    frase: opt.publico
      ? `Estimativa linear: deslocar ${pct(opt.frac * 100)} do gasto entregue a ${worst.nome} (${brl(verba)}) para ${best.nome} renderia ~+${compact(ganho)} ${o.nome} (${o.unit} ${brl(uW)} vs ${brl(uB)}) — exige segmentação ou criativo dirigido a esse público; a faixa e o gênero entregues não são a segmentação.`
      : opt.anuncio
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

/** Distribuição por faixa/gênero, eficiência por faixa e cobertura de n/d (sem comparação). */
function demoBase(rows: DemoRow[], metric: MetricKey): Achado[] {
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

/** Distribuição e eficiência por UF (só linhas com UF identificada). */
function geoBase(rows: GeoRow[], metric: MetricKey): Achado[] {
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
  const macros = [...porChave(sorted, macroDe)]
    .map(([nome, t]) => ({ nome, v: metricValue(t, metric) }))
    .sort((a, b) => b.v - a.v);
  if (total && macros.length >= 2) {
    const [m1, m2, m3] = macros as [typeof macros[0], typeof macros[0], typeof macros[0] | undefined];
    const p = (v: number) => pct(div(v, total) * 100, 1);
    out.push({
      tipo: 'outlier', bloco: 'distribuicao',
      frase: `Por macrorregião, ${m1.nome} lidera com ${p(m1.v)}, seguido de ${m2.nome} (${p(m2.v)})${m3 ? ` e ${m3.nome} (${p(m3.v)})` : ''}.`,
    });
  }
  return out;
}

// ── Abas dimensionais (idade & gênero, região) ─────────────────────────────
// Campanhas compara plataformas e campanhas; aqui o eixo é a própria fatia. O que muda:
// tendência é mudança de MIX (pontos percentuais de participação, não %), a comparação
// entre plataformas é de viés (onde cada uma concentra), e a recomendação nasce de
// aderência ao público-alvo (idade & gênero) e de penetração frente à população (região).

/** O que pesa numa participação: o volume da métrica ativa; em razão, as impressões. */
const massa = (t: TotalsLite, m: MetricKey) => (isVolume(m) ? metricValue(t, m) : t.impressions);
const massaLabel = (m: MetricKey) => (isVolume(m) ? METRICS[m].label : 'Impressões');
const ppAbs = (v: number) => `${nf(Math.abs(v), Math.abs(v) < 10 ? 1 : 0)} pp`;
const ppTxt = (v: number) => `${v >= 0 ? '+' : '−'}${ppAbs(v)}`;

function porChave<T extends TotalsLite>(
  rows: T[], key: (r: T) => string | null | undefined,
): Map<string, TotalsLite> {
  const map = new Map<string, TotalsLite>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    map.set(k, add(map.get(k) ?? ZERO, r));
  }
  return map;
}
/** Participação (%) de cada chave sobre o que foi identificado. */
function partDe(m: Map<string, TotalsLite>, metric: MetricKey): Map<string, number> {
  const tot = [...m.values()].reduce((s, t) => s + massa(t, metric), 0);
  return new Map([...m].map(([k, t]): [string, number] => [k, div(massa(t, metric), tot) * 100]));
}
function deslocamentos(cur: Map<string, number>, base: Map<string, number>) {
  return [...new Set([...cur.keys(), ...base.keys()])]
    .map((k) => ({ k, de: base.get(k) ?? 0, para: cur.get(k) ?? 0, dpp: (cur.get(k) ?? 0) - (base.get(k) ?? 0) }))
    .sort((a, b) => b.dpp - a.dpp);
}
const maiorDesvio = (d: ReturnType<typeof deslocamentos>, min: number) =>
  [...d].sort((a, b) => Math.abs(b.dpp) - Math.abs(a.dpp)).find((x) => Math.abs(x.dpp) >= min);
/** As duas janelas têm volume para comparar. */
const comparavel = (cur: TotalsLite, prev: TotalsLite | null) =>
  !!prev && prev.impressions >= PISO && cur.impressions >= PISO;

const faixaId = (r: { faixa: string }) => (r.faixa === 'n/d' ? null : r.faixa);
const generoId = (r: { gender: string }) => (r.gender === 'DESCONHECIDO' ? null : r.gender);
const generoNome = (g: string) => GENDER_LABEL[g] ?? g;
const macroDe = (r: { uf: string | null }) => (r.uf ? MACRO_BY_UF[r.uf] ?? null : null);
const nomePorUf = Object.fromEntries(Object.entries(UF_BY_NAME).map(([n, u]) => [u, n]));

/** Referência no formato de Campanhas: o recorte inteiro vira uma "plataforma" só. */
const refDe = (foco: FocoDim | null, ref: TotalsLite[]): Referencia | null =>
  foco && ref.length ? { foco: foco.foco, nome: foco.nome, porPlataforma: [{ platform: '', ...sum(ref) }] } : null;

/** Plataforma que concentra a entrega numa fatia bem acima do recorte (≥ 10 pp). */
function vies<T extends TotalsLite & { platform?: string }>(
  rows: T[], key: (r: T) => string | null, metric: MetricKey, rot: (k: string) => string,
): Achado[] {
  const plats = porChave(rows, (r) => r.platform ?? null);
  if (plats.size < 2) return [];
  const totalMassa = [...plats.values()].reduce((s, t) => s + massa(t, metric), 0);
  const geral = partDe(porChave(rows, key), metric);
  const cand: { p: string; k: string; v: number; g: number; d: number }[] = [];
  for (const [p, t] of plats) {
    if (t.impressions < PISO || div(massa(t, metric), totalMassa) < 0.1) continue;
    for (const [k, v] of partDe(porChave(rows.filter((r) => r.platform === p), key), metric)) {
      const g = geral.get(k) ?? 0;
      cand.push({ p, k, v, g, d: v - g });
    }
  }
  cand.sort((a, b) => b.d - a.d);
  const top = cand[0];
  if (!top || top.d < 10) return [];
  const second = cand.find((c) => c.p !== top.p && c.d >= 10);
  const txt = (c: typeof top) => `${platformLabel(c.p)} concentra ${fatia(c.v)} em ${rot(c.k)} (recorte: ${fatia(c.g)})`;
  return [{
    tipo: 'outlier', bloco: 'plataformas',
    frase: `Em ${massaLabel(metric)}, ${txt(top)}${second ? `; ${txt(second)}` : ''}.`,
  }];
}

/** Foco × demais do mesmo recorte: onde a composição do foco mais diverge (≥ 5 pp). */
function refMix<T extends TotalsLite>(
  foco: FocoDim | null, rows: T[], ref: T[], key: (r: T) => string | null, metric: MetricKey,
  dim: string, rot: (k: string) => string,
): Achado[] {
  if (!foco || !ref.length) return [];
  const cur = porChave(rows, key);
  const demais = new Map<string, TotalsLite>();
  for (const [k, t] of porChave(ref, key)) demais.set(k, menos(t, cur.get(k) ?? ZERO));
  if (sum([...demais.values()]).impressions < PISO) return [];
  const s = maiorDesvio(deslocamentos(partDe(cur, metric), partDe(demais, metric)), 5);
  if (!s) return [];
  const nome = foco.foco === 'campanha' ? foco.nome : platformLabel(foco.nome);
  const grupo = foco.foco === 'campanha' ? 'das demais campanhas' : 'das demais plataformas';
  return [{
    tipo: 'outlier', bloco: 'referencia',
    frase: `${nome}: em ${massaLabel(metric).toLowerCase()}, ${dim} ${rot(s.k)} pesa ${fatia(s.para)} contra ${fatia(s.de)} ${grupo} no mesmo recorte (${ppTxt(s.dpp)}).`,
  }];
}

// ── Idade & Gênero ─────────────────────────────────────────────────────────
function mixDemo(rows: DemoRow[], prev: DemoRow[] | null, metric: MetricKey): Achado[] {
  if (!prev?.length || !comparavel(sum(rows), sum(prev))) return [];
  const dims: { nome: string; key: (r: DemoRow) => string | null; rot: (k: string) => string }[] = [
    { nome: 'faixa', key: faixaId, rot: (k) => k },
    { nome: 'gênero', key: generoId, rot: generoNome },
  ];
  const partes: string[] = [];
  for (const d of dims) {
    const s = maiorDesvio(
      deslocamentos(partDe(porChave(rows, d.key), metric), partDe(porChave(prev, d.key), metric)), 3);
    if (s) partes.push(`${d.nome} ${d.rot(s.k)} foi de ${fatia(s.de)} para ${fatia(s.para)} (${ppTxt(s.dpp)})`);
  }
  if (!partes.length) return [];
  return [{
    tipo: 'mix_vs_rate', bloco: 'tendencia',
    frase: `Mix de ${massaLabel(metric).toLowerCase()} vs janela anterior: ${partes.join('; ')}.`,
  }];
}

/** Melhor e pior célula faixa × gênero (≥ 3% do gasto) por custo unitário ou taxa. */
function cruzado(rows: DemoRow[], prev: DemoRow[] | null, metric: MetricKey): Achado[] {
  const celulas = (rs: DemoRow[]) =>
    porChave(rs, (r) => (faixaId(r) && generoId(r) ? `${generoNome(r.gender)} ${r.faixa}` : null));
  const atual = celulas(rows);
  const tot = sum([...atual.values()]);
  const items: NamedRow[] = [...atual]
    .filter(([, t]) => div(t.cost, tot.cost) >= 0.03)
    .map(([nome, t]) => ({ ...t, nome, platform: '' }));
  return ranking(items, tot, prev ? celulas(prev) : new Map(), metric, 'eficiencia');
}

/** Células faixa × gênero identificadas, como linhas rankeáveis. A recomendação ignora 13-17:
 *  não se recomenda levar verba a menores de idade, e essa faixa é a que mais distorce o custo. */
const celulasItens = (rs: DemoRow[]): NamedRow[] =>
  [...porChave(rs, (r) => (faixaId(r) && generoId(r) ? `${generoNome(r.gender)} ${r.faixa}` : null))]
    .map(([nome, t]) => ({ ...t, nome, platform: '' }));

const BANDAS: Record<string, [number, number]> = {
  '13-17': [13, 17], '18-24': [18, 24], '25-34': [25, 34], '35-44': [35, 44], '45-54': [45, 54], '55+': [55, 200],
};
/** '18+' | '25 A 44' → [mín, máx]; qualquer outro texto não declara alvo de idade. */
export function parseAlvoIdade(s: string | null): [number, number] | null {
  const t = (s ?? '').trim();
  const mais = /^(\d{2})\s*\+$/.exec(t);
  if (mais) return [Number(mais[1]), 200];
  const faixa = /^(\d{2})\s*A\s*(\d{2,3})$/i.exec(t);
  return faixa ? [Number(faixa[1]), Number(faixa[2])] : null;
}
/** Faixa que se sobrepõe ao intervalo conta como dentro — as bordas são aproximadas
 *  (Kwai/TikTok já chegam com faixas próprias). null = não dá para julgar. */
export function faixaNoAlvo(faixa: string, alvo: string | null): boolean | null {
  const iv = parseAlvoIdade(alvo), b = BANDAS[faixa];
  return iv && b ? b[0] <= iv[1] && b[1] >= iv[0] : null;
}
const ALVO_GENERO: Record<string, string> = { H: 'HOMEM', M: 'MULHER' };
function situacao(r: AlvoRow): { s: 'dentro' | 'fora' | 'sem'; motivo?: string } {
  const idade = faixaNoAlvo(r.faixa, r.targetAge);
  const g = r.targetGender ? ALVO_GENERO[r.targetGender.toUpperCase()] : undefined;
  const genero = g && r.gender !== 'DESCONHECIDO' ? r.gender === g : null;
  if (idade === false) return { s: 'fora', motivo: `na faixa ${r.faixa}` };
  if (genero === false) return { s: 'fora', motivo: `no gênero ${generoNome(r.gender)}` };
  return idade === true || genero === true ? { s: 'dentro' } : { s: 'sem' };
}

/** Entregue × público-alvo declarado no nome da campanha. Sem alvo, sem frase. */
export function alvoAchados(alvo: AlvoRow[], metric: MetricKey): Achado[] {
  let dentro = ZERO, fora = ZERO, sem = ZERO;
  const motivos = new Map<string, TotalsLite>();
  for (const r of alvo) {
    const { s, motivo } = situacao(r);
    if (s === 'dentro') dentro = add(dentro, r);
    else if (s === 'sem') sem = add(sem, r);
    else { fora = add(fora, r); motivos.set(motivo!, add(motivos.get(motivo!) ?? ZERO, r)); }
  }
  const julgado = add(dentro, fora);
  const total = add(julgado, sem);
  if (total.impressions < PISO) return [];
  const cob = div(julgado.impressions, total.impressions);
  if (julgado.impressions < PISO || cob < 0.3) {
    return [{
      tipo: 'caveat', bloco: 'cobertura',
      frase: `Só ${fatia(cob * 100)} da entrega tem público-alvo declarado no nome da campanha — no resto não dá para medir aderência ao alvo.`,
    }];
  }
  const pFora = div(fora.impressions, julgado.impressions) * 100;
  if (div(fora.cost, julgado.cost) < 0.03) {
    return [{
      tipo: 'lider', bloco: 'cobertura',
      frase: `${fatia(100 - pFora)} da entrega com alvo declarado (${fatia(cob * 100)} do total) chegou dentro do público-alvo das campanhas.`,
    }];
  }
  const o = OUT[metric];
  const topMotivo = [...motivos].sort((a, b) => b[1].cost - a[1].cost)[0]![0];
  const uF = unitCost(fora, o), uD = unitCost(dentro, o);
  let est = '';
  if (metric !== 'investimento' && Number.isFinite(uF) && Number.isFinite(uD) && uF >= uD * 1.2) {
    const k = o.mil ? 1000 : 1;
    est = ` Estimativa linear: levar essa verba ao público-alvo (${o.unit} ${brl(uD)} contra ${brl(uF)}) renderia ~+${compact(fora.cost * (k / uD - k / uF))} ${o.nome}.`;
  }
  return [{
    tipo: 'recomendacao', bloco: 'recomendacao',
    frase: `${fatia(pFora)} da entrega com alvo declarado (R$ ${compact(fora.cost)}) chegou fora do público-alvo, sobretudo ${topMotivo}.${est} Faixa e gênero entregues não são a segmentação: confirme se o alvo é restrição ou só referência.`,
  }];
}

function demoAchados(a: {
  rows: DemoRow[]; previous: DemoRow[] | null; plat: DemoRow[]; ref: DemoRow[]; foco: FocoDim | null;
  alvo: AlvoRow[]; camps: NamedRow[]; redeFiltrada: boolean; metric: MetricKey;
}): Achado[] {
  const { rows, metric } = a;
  if (!rows.length) return [];
  const tot = sum(rows);
  const prevTot = a.previous?.length ? sum(a.previous) : null;

  const coberturas: Achado[] = [];
  const massaTotal = rows.reduce((s, r) => s + massa(r, metric), 0);
  const semGenero = div(rows.filter((r) => r.gender === 'DESCONHECIDO').reduce((s, r) => s + massa(r, metric), 0), massaTotal);
  if (semGenero >= 0.05) {
    coberturas.push({ tipo: 'caveat', bloco: 'cobertura', frase: `${fatia(semGenero * 100)} da entrega chega sem gênero identificado.` });
  }
  if (a.redeFiltrada) {
    coberturas.unshift({
      tipo: 'caveat', bloco: 'cobertura',
      frase: 'O filtro de rede não vale nesta aba: idade e gênero só trazem rede para o Google, então o recorte ignora essa seleção.',
    });
  }

  return [
    ...mixDemo(rows, a.previous, metric),
    ...tendencia(tot, prevTot && prevTot.impressions > 0 ? prevTot : null, metric),
    ...vies(a.plat, faixaId, metric, (k) => `faixa ${k}`),
    ...referencia(refDe(a.foco, a.ref), tot, [], metric),
    ...refMix(a.foco, rows, a.ref, faixaId, metric, 'faixa', (k) => k),
    ...refMix(a.foco, rows, a.ref, generoId, metric, 'gênero', generoNome),
    ...cruzado(rows, a.previous, metric),
    ...campanhas(a.camps, tot, metric),
    ...(a.redeFiltrada ? coberturas.slice(0, 1) : []),
    ...demoBase(rows, metric),
    ...alvoAchados(a.alvo, metric),
    ...realocar(celulasItens(rows.filter((r) => r.faixa !== '13-17')), sum(celulasItens(rows)), metric, { piso: 0.05, frac: 0.1, publico: true }),
    ...(a.redeFiltrada ? coberturas.slice(1) : coberturas),
  ];
}

// ── Região ─────────────────────────────────────────────────────────────────
function mixUf(rows: GeoRow[], prev: GeoRow[] | null, metric: MetricKey): Achado[] {
  if (!prev?.length || !comparavel(sum(rows), sum(prev))) return [];
  const nome = new Map([...rows, ...prev].map((r): [string, string] => [r.uf!, r.estado]));
  const d = deslocamentos(partDe(porChave(rows, (r) => r.uf), metric), partDe(porChave(prev, (r) => r.uf), metric));
  const up = d[0], down = d[d.length - 1];
  const fmt = (x: NonNullable<typeof up>, verbo: string) =>
    `${nome.get(x.k) ?? x.k} ${verbo} ${ppAbs(x.dpp)} (de ${fatia(x.de)} para ${fatia(x.para)})`;
  const partes = [
    ...(up && up.dpp >= 2 ? [fmt(up, 'ganhou')] : []),
    ...(down && down !== up && down.dpp <= -2 ? [fmt(down, 'perdeu')] : []),
  ];
  if (!partes.length) return [];
  return [{
    tipo: 'mix_vs_rate', bloco: 'tendencia',
    frase: `Mix de ${massaLabel(metric).toLowerCase()} vs janela anterior: ${partes.join(' e ')}.`,
  }];
}

/** Entrega ÷ população (Censo 2022) nas UFs com ≥ 2% dos habitantes. */
export function penetracao(rows: GeoRow[]): Achado[] {
  const porUf = porChave(rows, (r) => r.uf);
  const totalImp = sum(rows).impressions;
  const popTotal = Object.values(POP_BY_UF).reduce((s, v) => s + v, 0);
  if (totalImp < PISO * 10 || [...porUf.values()].filter((t) => t.impressions >= PISO).length < 8) return [];
  const cand = Object.entries(POP_BY_UF)
    .map(([uf, pop]) => {
      const imp = porUf.get(uf)?.impressions ?? 0;
      const popS = pop / popTotal, impS = imp / totalImp;
      return { uf, popS, impS, imp, idx: impS / popS };
    })
    .filter((c) => c.popS >= 0.02)
    .sort((x, y) => y.idx - x.idx);
  const hi = cand[0], lo = cand[cand.length - 1];
  if (!hi || !lo || hi === lo || hi.idx < lo.idx * 2) return [];
  const est = (uf: string) => nomePorUf[uf] ?? uf;
  const baixo = lo.imp > 0
    ? `só ${vx(lo.idx)} (${fatia(lo.popS * 100)} dos habitantes, ${fatia(lo.impS * 100)} das impressões)`
    : `não recebeu entrega (${fatia(lo.popS * 100)} dos habitantes)`;
  return [{
    tipo: 'recomendacao', bloco: 'recomendacao',
    frase: `Frente ao peso demográfico (Censo 2022), ${est(hi.uf)} recebe ${vx(hi.idx)} o que a população indicaria (${fatia(hi.popS * 100)} dos habitantes, ${fatia(hi.impS * 100)} das impressões) e ${est(lo.uf)} ${baixo}. Se a campanha é nacional, vale reforçar ${est(lo.uf)}; um alvo regional declarado explicaria a diferença.`,
  }];
}

function geoAchados(a: {
  rows: GeoRow[]; previous: GeoRow[] | null; plat: GeoRow[]; ref: GeoRow[]; foco: FocoDim | null;
  camps: NamedRow[]; redeFiltrada: boolean; metric: MetricKey;
}): Achado[] {
  const { metric } = a;
  if (!a.rows.length) return [];
  const identificada = (r: GeoRow) => !!r.uf && !!MACRO_BY_UF[r.uf];
  const ident = a.rows.filter(identificada);
  const prevIdent = (a.previous ?? []).filter(identificada);
  const tot = sum(a.rows);
  const prevTot = a.previous?.length ? sum(a.previous) : null;
  const identTot = sum(ident);

  const macros = (rs: GeoRow[]) => porChave(rs, macroDe);
  const macroItems: NamedRow[] = [...macros(ident)].map(([nome, t]) => ({ ...t, nome, platform: '' }));
  const ufItems: NamedRow[] = ident.map((r) => ({ ...r, nome: r.estado, platform: r.platform ?? '' }));

  const coberturas: Achado[] = [];
  const semUf = div(sum(a.rows.filter((r) => !identificada(r))).impressions, tot.impressions);
  if (semUf >= 0.02) {
    coberturas.push({
      tipo: 'caveat', bloco: 'cobertura',
      frase: `${fatia(semUf * 100)} das impressões vêm de regiões que não são UFs brasileiras e ficam fora do mapa e do ranking.`,
    });
  }
  if (a.redeFiltrada) {
    coberturas.unshift({
      tipo: 'caveat', bloco: 'cobertura',
      frase: 'O filtro de rede não vale nesta aba: região só traz rede para o Google, então o recorte ignora essa seleção.',
    });
  }

  return [
    ...mixUf(ident, prevIdent.length ? prevIdent : null, metric),
    ...tendencia(tot, prevTot && prevTot.impressions > 0 ? prevTot : null, metric),
    ...vies(a.plat.filter(identificada), macroDe, metric, (k) => k),
    ...referencia(refDe(a.foco, a.ref), tot, [], metric),
    ...refMix(a.foco, ident, a.ref, macroDe, metric, 'macrorregião', (k) => k),
    ...ranking(macroItems, identTot, macros(prevIdent), metric, 'eficiencia'),
    ...campanhas(a.camps, tot, metric),
    ...geoBase(ident, metric),
    ...(a.redeFiltrada ? coberturas.slice(0, 1) : []),
    ...penetracao(ident),
    ...realocar(ufItems, identTot, metric, { piso: 0.05, frac: 0.1 }),
    ...(a.redeFiltrada ? coberturas.slice(1) : coberturas),
  ];
}
