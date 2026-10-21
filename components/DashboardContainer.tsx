"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CampaignRulesModal from "./CampaignRulesModal";
import DashboardExportModal from "./DashboardExportModal";
import ChartWidget from "./ChartWidget";
import HudBackground from "./HudBackground";
import HudCorners from "./HudCorners";
import SearchableSelect from "./SearchableSelect";
import ThemeToggle from "./ThemeToggle";
import { postJson } from "@/lib/fetchUtils";
import { AGE_ORDER, ENGAGEMENT_PARTS, GENDERS, GENDER_LABEL, METRICS, networkLabel, platformLabel, type EngagementPartKey, type MetricKey } from "@/lib/dashboard";
import { buildAchados, kpiDeltaLabel } from "@/lib/dashboardInsights";
import { PRESET_DAYS, parsePrefs, prefsKey, type Prefs } from "@/lib/dashboardPrefs";
import type { ChartData } from "@/types/chat";

type Tab = "campanhas" | "demografia" | "regiao";
type Gran = "dia" | "semana" | "mes";
type EngMode = "total" | "partes";

type Totals = { cost: number; impressions: number; reach: number; clicks: number; videoViews: number; engagement: number }
  & Record<EngagementPartKey, number>;
type Row = Totals & { platform: string; network: string; nome: string;
  p25: number; p50: number; p75: number; p95: number; p100: number; completions: number };

type Payload = {
  totals?: Totals & { campaigns: number; ads: number };
  previous?: Totals | null;
  daily?: (Totals & { date: string })[];
  campanhas?: Row[];
  anuncios?: Row[];
  limit?: number;
  demografia?: (Totals & { faixa: string; gender: string })[];
  regioes?: (Totals & { estado: string; uf: string | null })[];
  error?: string;
};

type FiltersData = {
  platforms: string[];
  networks: string[];
  accounts: string[];
  objectives: string[];
  buyingTypes: string[];
  temas: { code: string; label: string }[];
  campaigns: string[];
  ads: { campaign: string | null; ad: string }[];
};

const METRIC_KEYS: MetricKey[] = ["alcance", "impressoes", "cliques", "visualizacoes", "engajamento", "investimento", "ctr", "cpc", "cpv", "cpe", "vtr", "tx_eng"];

const nf = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number) => `R$ ${nf(v, 2)}`;
/** Centavos são ruído acima de dez mil — e faziam a tile de Investimento truncar. */
const brlShort = (v: number) => (Math.abs(v) >= 10_000 ? `R$ ${nf(Math.round(v))}` : brl(v));
const pct = (v: number, d = 2) => `${nf(v, d)}%`;
const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf(v / 1e9, 2)} bi`;
  if (a >= 1e6) return `${nf(v / 1e6, 1)} mi`;
  if (a >= 1e3) return `${nf(v / 1e3, 0)} mil`;
  return nf(v);
};
const div = (a: number, b: number) => (b ? a / b : 0);
/** Razão com denominador zero volta NaN de metricValue; onde um gráfico precisa de
 *  número (sort, choropleth, larguras) o não-finito vira 0. A tabela usa fmtMetric,
 *  que mostra traço. */
const finite = (v: number) => (Number.isFinite(v) ? v : 0);
const dash = "—";
/** Componentes com algum valor na janela filtrada. Reações só vêm do Facebook e
 *  salvos de Facebook + Pinterest — sem esse filtro a maioria dos recortes
 *  carregaria duas séries e duas colunas cravadas em zero. */
const activeParts = (rows: Totals[]) => ENGAGEMENT_PARTS.filter((p) => rows.some((r) => r[p.key] > 0));
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Colunas somáveis da tabela — razão (CPM, CTR…) se recalcula do total, não se soma. */
const SUMMABLE: (keyof Totals | "p25" | "p50" | "p75" | "p95" | "p100" | "completions")[] = [
  "cost", "impressions", "reach", "clicks", "videoViews", "engagement",
  ...ENGAGEMENT_PARTS.map((p) => p.key),
  "p25", "p50", "p75", "p95", "p100", "completions",
];
const zeroRow = (): Row => ({
  platform: "", network: "", nome: "",
  cost: 0, impressions: 0, reach: 0, clicks: 0, videoViews: 0, engagement: 0,
  p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, completions: 0,
  ...(Object.fromEntries(ENGAGEMENT_PARTS.map((p) => [p.key, 0])) as Record<EngagementPartKey, number>),
});

// ── Ordenação por cabeçalho: desc → asc → padrão (null) ──
type Sort = { key: string; dir: "asc" | "desc" } | null;
const nextSort = (cur: Sort, key: string): Sort =>
  cur?.key !== key ? { key, dir: "desc" } : cur.dir === "desc" ? { key, dir: "asc" } : null;
/** Texto compara em pt-BR; não-finito (razão sem denominador, traço na tela) fica no fim nas duas direções. */
function sortRows<T>(rows: T[], sort: Sort, get: (r: T, key: string) => number | string): T[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a, sort.key), y = get(b, sort.key);
    if (typeof x === "string" || typeof y === "string") return sign * String(x).localeCompare(String(y), "pt-BR");
    const bad = !Number.isFinite(x), badY = !Number.isFinite(y);
    if (bad || badY) return bad === badY ? 0 : bad ? 1 : -1;
    return sign * (x - y);
  });
}
const DASH_WHEN_ZERO = new Set<string>(["p25", "p50", "p75", "p95", "p100", "completions", ...ENGAGEMENT_PARTS.map((p) => p.key)]);
/** Valor que a célula da tabela de Performance mostra (mesmas razões do render). */
function perfValue(r: Row, key: string): number | string {
  switch (key) {
    case "platform": return platformLabel(r.platform);
    case "network": return networkLabel(r.network);
    case "nome": return r.nome;
    case "cpm": return div(r.cost, r.impressions) * 1000;
    case "cpc": return r.clicks ? r.cost / r.clicks : NaN;
    case "ctr": return div(r.clicks, r.impressions);
    case "cpe": return r.engagement ? r.cost / r.engagement : NaN;
    case "txeng": return div(r.engagement, r.impressions);
    case "cpv": return r.videoViews ? r.cost / r.videoViews : NaN;
    case "vtr": return div(r.videoViews, r.impressions);
    default: {
      const v = r[key as keyof Totals | "p25" | "p50" | "p75" | "p95" | "p100" | "completions"];
      return DASH_WHEN_ZERO.has(key) && !v ? NaN : v;
    }
  }
}

function SortTh({ label, k, sort, onSort, className }: {
  label: string; k: string; sort: Sort; onSort: (k: string) => void; className: string;
}) {
  const on = sort?.key === k;
  return (
    <th className={className} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 cursor-pointer uppercase tracking-[0.16em] font-hud hover:text-ink ${on ? "text-accent-text" : ""}`}>
        {label}<span aria-hidden className="text-[8px]">{on ? (sort!.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

/** Value of a metric over one aggregate row — mirrors metricValue in lib/dashboardInsights.
 *  Razões com denominador zero devolvem NaN (um "R$ 0,00" de CPV numa fatia sem view é
 *  ruído): fmtMetric e o scatter tratam o não-finito como traço / ponto omitido. */
function metricValue(t: Totals, m: MetricKey): number {
  switch (m) {
    case "investimento": return t.cost;
    case "impressoes": return t.impressions;
    case "alcance": return t.reach;
    case "cliques": return t.clicks;
    case "visualizacoes": return t.videoViews;
    case "engajamento": return t.engagement;
    case "ctr": return div(t.clicks, t.impressions) * 100;
    case "cpc": return t.clicks ? t.cost / t.clicks : NaN;
    case "cpv": return t.videoViews ? t.cost / t.videoViews : NaN;
    case "cpe": return t.engagement ? t.cost / t.engagement : NaN;
    case "vtr": return t.impressions ? (t.videoViews / t.impressions) * 100 : NaN;
    case "tx_eng": return t.impressions ? (t.engagement / t.impressions) * 100 : NaN;
  }
}
/** Métrica de uma fatia com várias sub-linhas. Para razão (kind != count) soma
 *  numerador e denominador ANTES de dividir — nunca a média das razões. */
function aggMetric(rows: Totals[], m: MetricKey): number {
  if (METRICS[m].kind === "count") return rows.reduce((s, r) => s + metricValue(r, m), 0);
  const t = rows.reduce(
    (a, r) => {
      a.cost += r.cost; a.impressions += r.impressions; a.reach += r.reach;
      a.clicks += r.clicks; a.videoViews += r.videoViews; a.engagement += r.engagement;
      return a;
    },
    { cost: 0, impressions: 0, reach: 0, clicks: 0, videoViews: 0, engagement: 0 },
  );
  return metricValue(t as Totals, m);
}
const fmtMetric = (v: number, m: MetricKey) =>
  !Number.isFinite(v) ? dash
    : METRICS[m].kind === "currency" ? brl(v)
    : METRICS[m].kind === "pct" ? pct(v)
    : nf(Math.round(v));

/** 72×24 sparkline for a KPI tile. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg width="72" height="24" aria-hidden="true" />;
  const max = Math.max(...values), min = Math.min(...values);
  const x = (i: number) => 2 + i * (68 / (values.length - 1));
  const y = (v: number) => 22 - ((v - min) / (max - min || 1)) * 18;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  return (
    <svg width="72" height="24" viewBox="0 0 72 24" fill="none" aria-hidden="true">
      <path d={`${d}L${x(values.length - 1).toFixed(1)} 24L${x(0).toFixed(1)} 24Z`} fill="var(--hud-cyan)" opacity="0.13" />
      <path d={d} stroke="var(--hud-cyan)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function DashboardContainer({ isAdmin = false, userId }: { isAdmin?: boolean; userId: string }) {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  // Todo filtro é multi-valor: [] = sem filtro, N valores = OR dentro do filtro
  // e AND entre filtros (Meta OU TikTok, E objetivo "tráfego").
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [networks, setNetworks] = useState<string[]>([]);
  // Conta de anúncio (`account_name`); no Kwai é o nome da agência.
  const [accounts, setAccounts] = useState<string[]>([]);
  const [ads, setAds] = useState<string[]>([]);
  const [objectives, setObjectives] = useState<string[]>([]);
  // Tipo de compra (CPM/CPC/CPV/CPE) é derivado do objetivo no servidor — ver
  // BUYING_TYPE_SQL em lib/dashboard.
  const [buyingTypes, setBuyingTypes] = useState<string[]>([]);
  const [temas, setTemas] = useState<string[]>([]);

  const [tab, setTab] = useState<Tab>("campanhas");
  const [metric, setMetric] = useState<MetricKey>("impressoes");
  const [gran, setGran] = useState<Gran>("dia");
  const [tmode, setTmode] = useState<"campanha" | "anuncio">("campanha");
  const [engMode, setEngMode] = useState<EngMode>("total");
  // Quebra a tabela por sub-rede: Meta vira Facebook/Instagram, Google vira YouTube/Busca.
  const [byNetwork, setByNetwork] = useState(false);

  // Editor de regras de grupo (só admin). `rulesVersion` força o refetch dos filtros
  // depois de salvar — o dropdown É o preview das regras.
  const [rulesOpen, setRulesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [rulesVersion, setRulesVersion] = useState(0);

  const [perfSort, setPerfSort] = useState<Sort>(null);
  const [regSort, setRegSort] = useState<Sort>(null);
  const [filtersData, setFiltersData] = useState<FiltersData | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Filtros lembrados (localStorage, por usuário) ──
  // Restaura num efeito, não no inicializador do useState: o componente renderiza no
  // servidor e ler o storage ali geraria mismatch de hidratação. Os fetches esperam
  // `ready`, senão sairia uma requisição com os padrões antes da restauração.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const p = parsePrefs(localStorage.getItem(prefsKey(userId)));
      if (p.days) { setFrom(isoDaysAgo(p.days)); setTo(isoDaysAgo(0)); }
      else if (p.from && p.to) { setFrom(p.from); setTo(p.to); }
      if (p.campaigns) setCampaigns(p.campaigns);
      if (p.platforms) setPlatforms(p.platforms);
      if (p.networks) setNetworks(p.networks);
      if (p.accounts) setAccounts(p.accounts);
      if (p.ads) setAds(p.ads);
      if (p.objectives) setObjectives(p.objectives);
      if (p.buyingTypes) setBuyingTypes(p.buyingTypes);
      if (p.temas) setTemas(p.temas);
      if (p.tab) setTab(p.tab);
      if (p.metric) setMetric(p.metric);
      if (p.gran) setGran(p.gran);
      if (p.tmode) setTmode(p.tmode);
      if (p.engMode) setEngMode(p.engMode);
      if (p.byNetwork !== undefined) setByNetwork(p.byNetwork);
    } catch { /* storage bloqueado (janela privada): abre nos padrões */ }
    setReady(true);
  }, [userId]);

  useEffect(() => {
    if (!ready) return;
    // "últimos N dias" salvo como atalho: amanhã continua sendo os últimos N dias.
    const days = PRESET_DAYS.find((d) => from === isoDaysAgo(d) && to === isoDaysAgo(0));
    const prefs: Prefs = { ...(days ? { days } : { from, to }), campaigns, platforms, networks, accounts, ads,
      objectives, buyingTypes, temas, tab, metric, gran, tmode, engMode, byNetwork };
    try { localStorage.setItem(prefsKey(userId), JSON.stringify(prefs)); } catch { /* idem */ }
  }, [ready, userId, from, to, campaigns, platforms, networks, accounts, ads, objectives, buyingTypes, temas, tab, metric, gran, tmode, engMode, byNetwork]);

  // ── Opções dos dropdowns (facetadas) ──
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ from, to });
      // Repetido por valor (`platform=meta&platform=tiktok`) — a rota lê com getAll.
      for (const v of campaigns) qs.append("campaign", v);
      for (const v of platforms) qs.append("platform", v);
      for (const v of networks) qs.append("network", v);
      for (const v of accounts) qs.append("account", v);
      for (const v of objectives) qs.append("objective", v);
      for (const v of buyingTypes) qs.append("buyingType", v);
      for (const v of temas) qs.append("tema", v);
      try {
        const res = await fetch(`/api/dashboard/filters?${qs}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error();
        setFiltersData(await res.json());
      } catch {
        if (!ctrl.signal.aborted) setFiltersData({ platforms: [], networks: [], accounts: [], objectives: [], buyingTypes: [], temas: [], campaigns: [], ads: [] });
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [ready, from, to, campaigns, platforms, networks, accounts, objectives, buyingTypes, temas, rulesVersion]);

  // ── Dados da aba ativa ──
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await postJson("/api/dashboard/data",
          { from, to, campaign: campaigns, platform: platforms, networks, account: accounts, ad: ads, objective: objectives,
            buyingType: buyingTypes, tema: temas, tab, gran, network: byNetwork },
          { signal: ctrl.signal });
        const json = (await res.json()) as Payload;
        if (ctrl.signal.aborted) return;
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setError("");
        // Keep the other tabs' slices so switching back doesn't blank the screen.
        setData((prev) => ({ ...prev, ...json }));
      } catch (e) {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "Falha ao carregar os dados.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [ready, from, to, campaigns, platforms, networks, accounts, ads, objectives, buyingTypes, temas, tab, gran, byNetwork]);

  const adOptions = useMemo(
    () => (filtersData?.ads ?? [])
      .filter((a) => !campaigns.length || (a.campaign && campaigns.includes(a.campaign)))
      .map((a) => a.ad),
    [filtersData, campaigns]
  );

  // O select de tema guarda o código (`ECO`) e mostra o rótulo humano.
  const temaLabel = useMemo(() => {
    const byCode = new Map((filtersData?.temas ?? []).map((t) => [t.code, t.label]));
    return (code: string) => byCode.get(code) ?? code;
  }, [filtersData?.temas]);

  const totals = data?.totals;
  const daily = data?.daily ?? [];

  // ── KPIs + faixa de razões ──
  const kpis = useMemo(() => {
    if (!totals) return [];
    const prev = data?.previous ?? null;
    const defs: { label: string; value: string; key: keyof Totals }[] = [
      { label: "Investimento", value: brlShort(totals.cost), key: "cost" },
      { label: "Impressões", value: nf(totals.impressions), key: "impressions" },
      { label: "Alcance", value: nf(totals.reach), key: "reach" },
      { label: "Cliques", value: nf(totals.clicks), key: "clicks" },
      { label: "Visualizações", value: nf(totals.videoViews), key: "videoViews" },
      { label: "Engajamento", value: nf(totals.engagement), key: "engagement" },
    ];
    return defs.map((d) => {
      const now = totals[d.key];
      const delta = kpiDeltaLabel(now, prev ? prev[d.key] : null);
      return {
        ...d,
        delta: delta.text,
        deltaColor: delta.color === "up" ? "var(--success)" : delta.color === "down" ? "var(--danger)" : "var(--ink-3)",
        spark: daily.map((r) => r[d.key]),
      };
    });
  }, [totals, data?.previous, daily]);

  const ratios = useMemo(() => {
    if (!totals) return [];
    return [
      { label: "CPM", value: brl(div(totals.cost, totals.impressions) * 1000) },
      { label: "CPC", value: brl(div(totals.cost, totals.clicks)) },
      { label: "CTR", value: pct(div(totals.clicks, totals.impressions) * 100) },
      { label: "CPV", value: brl(div(totals.cost, totals.videoViews)) },
      { label: "VTR", value: pct(div(totals.videoViews, totals.impressions) * 100) },
      { label: "CPE", value: brl(div(totals.cost, totals.engagement)) },
      { label: "Tx. Eng.", value: pct(div(totals.engagement, totals.impressions) * 100) },
    ];
  }, [totals]);

  // ── Gráficos ──
  const trendChart = useMemo<ChartData | null>(() => {
    if (!daily.length) return null;
    return {
      type: "line",
      title: "Alcance, impressões e visualizações",
      labels: daily.map((r) => r.date.slice(8, 10) + "/" + r.date.slice(5, 7)),
      datasets: [
        { label: "Alcance", data: daily.map((r) => r.reach) },
        { label: "Impressões", data: daily.map((r) => r.impressions) },
        { label: "Visualizações", data: daily.map((r) => r.videoViews) },
      ],
    };
  }, [daily]);

  // Engajamento vive num gráfico próprio: a ordem de grandeza é outra e um
  // segundo eixo y no mesmo plot distorce a leitura.
  const engChart = useMemo<ChartData | null>(() => {
    if (!daily.length) return null;
    const labels = daily.map((r) => r.date.slice(8, 10) + "/" + r.date.slice(5, 7));
    const parts = engMode === "partes" ? activeParts(daily) : [];
    // Cada tipo sai do zero, NÃO empilhado. Empilhando, a curva de cima ficava
    // desenhada na soma acumulada com a cor da série menor — num dia de 2.858
    // curtidas e 26 compartilhamentos as duas curvas saíam a 26 de distância e
    // o "Compart." aparecia colado no total. Do zero, cada uma marca o seu valor.
    if (parts.length) return {
      type: "line",
      title: "Engajamento por tipo",
      labels,
      datasets: parts.map((p) => ({ label: p.label, data: daily.map((r) => r[p.key]) })),
    };
    return {
      type: "area",
      title: "Engajamento (curtidas + comentários + compart. + reações + salvos)",
      labels,
      datasets: [{ label: "Engajamento", data: daily.map((r) => r.engagement) }],
    };
  }, [daily, engMode]);

  const scatterChart = useMemo<ChartData | null>(() => {
    const rows = data?.campanhas ?? [];
    if (!rows.length) return null;
    // Eixo x = impressões; só quando a métrica É impressões o x vira investimento
    // (impressões × impressões seria uma diagonal).
    const byCost = metric === "impressoes";
    return {
      type: "scatter",
      title: `${METRICS[metric].label} por ${byCost ? "investimento" : "impressões"}`,
      xLabel: byCost ? "Investimento (R$)" : "Impressões",
      yLabel: METRICS[metric].label,
      datasets: [{
        label: METRICS[metric].label,
        data: rows.map((r) => ({ x: byCost ? r.cost : r.impressions, y: metricValue(r, metric) })),
        meta: rows.map((r) => ({
          Campanha: r.nome.length > 60 ? r.nome.slice(0, 60) + "…" : r.nome,
          Plataforma: platformLabel(r.platform),
          Investimento: brl(r.cost),
          Impressões: compact(r.impressions),
          CPM: brl(div(r.cost, r.impressions) * 1000),
        })),
      }],
    };
  }, [data?.campanhas, metric]);

  const ageChart = useMemo<ChartData | null>(() => {
    const rows = data?.demografia ?? [];
    if (!rows.length) return null;
    const faixas = AGE_ORDER.filter((f) => rows.some((r) => r.faixa === f));
    // Discriminado, a barra empilha por tipo de interação; o recorte por gênero
    // sai do gráfico (a rosca ao lado continua respondendo por ele).
    const parts = engMode === "partes" && metric === "engajamento" ? activeParts(rows) : [];
    if (parts.length) return {
      type: "bar",
      stacked: true,
      title: "Engajamento por faixa etária e tipo",
      labels: [...faixas],
      datasets: parts.map((p) => ({
        label: p.label,
        data: faixas.map((f) => rows.filter((r) => r.faixa === f).reduce((s, r) => s + r[p.key], 0)),
      })),
    };
    return {
      type: "bar",
      title: `${METRICS[metric].label} por faixa etária e gênero`,
      labels: [...faixas],
      datasets: GENDERS.map((g) => ({
        label: GENDER_LABEL[g],
        data: faixas.map((f) => {
          const r = rows.find((x) => x.faixa === f && x.gender === g);
          return finite(r ? metricValue(r, metric) : 0);
        }),
      })),
    };
  }, [data?.demografia, metric, engMode]);

  const genderChart = useMemo<ChartData | null>(() => {
    const rows = data?.demografia ?? [];
    if (!rows.length) return null;
    // Fatia sem denominador (razão → NaN) entra na pizza como 0: some, não quebra o path.
    const byGender = GENDERS.map((g) => finite(aggMetric(rows.filter((r) => r.gender === g), metric)));
    return {
      type: "pie",
      title: `${METRICS[metric].label} por gênero`,
      labels: GENDERS.map((g) => GENDER_LABEL[g]),
      datasets: [{ label: METRICS[metric].label, data: byGender }],
    };
  }, [data?.demografia, metric]);

  const regiaoRows = useMemo(() => {
    const rows = (data?.regioes ?? []).filter((r) => r.uf);
    return rows
      .map((r) => ({ ...r, uf: r.uf as string, value: metricValue(r, metric) }))
      .sort((a, b) => finite(b.value) - finite(a.value));
  }, [data?.regioes, metric]);

  const geoChart = useMemo<ChartData | null>(() => {
    if (!regiaoRows.length) return null;
    return {
      type: "geo",
      title: `${METRICS[metric].label} por UF`,
      labels: regiaoRows.map((r) => r.uf),
      datasets: [{
        label: METRICS[metric].label,
        data: regiaoRows.map((r) => finite(r.value)),
        meta: regiaoRows.map((r) => ({ Estado: r.estado, [METRICS[metric].label]: fmtMetric(r.value, metric) })),
      }],
    };
  }, [regiaoRows, metric]);

  // Achados pré-computados: a IA só redige; se ela cair, estas frases vão para a tela.
  const achados = useMemo(() => buildAchados({
    tab, metric, totals, previous: data?.previous ?? null,
    campanhas: data?.campanhas, demografia: data?.demografia,
    regioes: regiaoRows,
  }), [tab, metric, totals, data?.previous, data?.campanhas, data?.demografia, regiaoRows]);
  const observacoes = useMemo(() => achados.map((a) => a.frase), [achados]);
  const insightsInput = useMemo(() => (achados.length ? { achados } : null), [achados]);

  const [aiInsights, setAiInsights] = useState<string[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiCache = useRef(new Map<string, string[]>());

  useEffect(() => {
    if (!insightsInput) { setAiInsights(null); setAiLoading(false); return; }
    const payload = { tab, metric, periodo: { from, to },
      filtros: { campaign: campaigns, platform: platforms, network: networks, account: accounts, ad: ads, objective: objectives,
        buyingType: buyingTypes, tema: temas },
      resumo: insightsInput };
    const key = JSON.stringify(payload);
    const cached = aiCache.current.get(key);
    if (cached) { setAiInsights(cached); setAiLoading(false); return; }

    const ctrl = new AbortController();
    setAiLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await postJson("/api/dashboard/insights", payload, { signal: ctrl.signal });
        const json = (await res.json()) as { insights?: string[] };
        if (ctrl.signal.aborted) return;
        if (!res.ok || !json.insights?.length) throw new Error("sem insights");
        aiCache.current.set(key, json.insights);
        setAiInsights(json.insights);
      } catch {
        if (!ctrl.signal.aborted) setAiInsights(null); // cai nas observações determinísticas
      } finally {
        if (!ctrl.signal.aborted) setAiLoading(false);
      }
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(insightsInput), tab, metric, from, to, campaigns, platforms, networks, accounts, ads, objectives, buyingTypes, temas]);

  // ── Estilos herdados do SentimentosContainer ──
  const selectClass =
    "bg-fill border border-separator rounded-lg px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-accent-border appearance-none cursor-pointer w-full min-w-0 truncate";
  const dateClass =
    "bg-fill border border-separator rounded-lg px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-accent-border cursor-pointer";
  const pill = (on: boolean) =>
    `px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
      on ? "bg-accent-soft border-accent-border text-accent-text" : "bg-fill border-separator text-ink-3 hover:text-ink"
    }`;
  const engSwitch = (
    <div className="flex items-center gap-2">
      <span className="font-hud text-[9px] uppercase tracking-[0.2em] text-ink-3">Engajamento</span>
      <button className={pill(engMode === "total")} onClick={() => setEngMode("total")}>Total</button>
      <button className={pill(engMode === "partes")} onClick={() => setEngMode("partes")}>Discriminado</button>
    </div>
  );
  const tabCls = (on: boolean) =>
    `px-4 py-2.5 rounded-lg font-hud text-[10px] uppercase tracking-[0.16em] border transition-colors ${
      on ? "bg-accent-soft border-accent-border text-accent-text" : "border-separator text-ink-3 hover:text-ink-2"
    }`;
  const panel = "relative hud-panel rounded-[16px]";
  const panelTitle = "font-hud text-[11px] uppercase tracking-[0.24em] text-ink flex items-center gap-2";

  const rawRows = tmode === "campanha" ? (data?.campanhas ?? []) : (data?.anuncios ?? []);
  const tableRows = useMemo(() => sortRows(rawRows, perfSort, perfValue), [rawRows, perfSort]);
  const regiaoSorted = useMemo(() => sortRows(regiaoRows, regSort, (r, k) =>
    k === "uf" ? r.uf : k === "estado" ? r.estado : k === "value" ? r.value
      : (r[k as EngagementPartKey] || NaN)), [regiaoRows, regSort]);
  // Comentários fica sempre na tabela (traço quando a plataforma não reporta); as demais
  // partes só aparecem no modo Discriminado e se tiverem valor na janela.
  const tableParts = ENGAGEMENT_PARTS.filter((p) =>
    p.key === "comments" || (engMode === "partes" && tableRows.some((r) => r[p.key] > 0)));
  // Linha de total: soma das linhas MOSTRADAS (a tabela é cortada nas 50 maiores),
  // com as razões recalculadas dos somatórios — média de médias não é o CPM.
  const tableTotal = tableRows.reduce((a, r) => {
    for (const k of SUMMABLE) a[k] += r[k];
    return a;
  }, zeroRow());
  const regiaoParts = engMode === "partes" && metric === "engajamento" ? activeParts(regiaoRows) : [];

  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden relative hud-theme hud-void-bg">
      <HudBackground variant="subtle" />
      {rulesOpen && (
        <CampaignRulesModal onClose={() => setRulesOpen(false)} onSaved={() => setRulesVersion((v) => v + 1)} />
      )}
      {exportOpen && (
        <DashboardExportModal
          onClose={() => setExportOpen(false)}
          initial={tab === "campanhas" ? "campanhas" : tab}
          filters={{ from, to, campaign: campaigns, platform: platforms, account: accounts, ad: ads, objective: objectives,
            buyingType: buyingTypes, tema: temas }}
        />
      )}

      <header className="relative z-10 shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 pb-3 md:pb-4 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-4 border-b border-separator">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link href="/" className="font-hud text-[10px] uppercase tracking-[0.2em] text-ink-3 hover:text-ink transition-colors py-3 -my-3 shrink-0">
            Início
          </Link>
          <span className="text-ink-4 text-xs shrink-0">›</span>
          <h1 className="font-hud text-[10px] uppercase tracking-[0.16em] text-ink truncate"
              style={{ textShadow: "0 0 10px color-mix(in srgb, var(--hud-cyan) 30%, transparent)" }}>
            Dashboard
          </h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => setExportOpen(true)}
            className="font-hud text-[10px] uppercase tracking-[0.16em] px-3 py-1.5 rounded-lg border border-separator text-ink-3 hover:text-ink hover:border-accent-border transition-colors">
            Exportar
          </button>
          <ThemeToggle />
          <span className="text-[15px] leading-none animate-hud-flicker motion-reduce:animate-none"
                style={{ color: "var(--hud-cyan)", textShadow: "0 0 12px var(--hud-cyan)" }}>◇</span>
        </div>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 space-y-5">

          {/* ── Abas ── */}
          <div className="flex gap-2 overflow-x-auto">
            <button className={tabCls(tab === "campanhas")} onClick={() => setTab("campanhas")}>Campanhas</button>
            <button className={tabCls(tab === "demografia")} onClick={() => setTab("demografia")}>Idade &amp; Gênero</button>
            <button className={tabCls(tab === "regiao")} onClick={() => setTab("regiao")}>Região</button>
          </div>

          {/* ── Filtros ── */}
          <section className={`${panel} z-20 px-4 py-5 md:px-6`}>
            <HudCorners accent="cyan" size={16} inset={8} />
            <div className="space-y-5">
              <div className={panelTitle} style={{ textShadow: "0 0 12px color-mix(in srgb, var(--hud-cyan) 35%, transparent)" }}>
                <span style={{ color: "var(--hud-cyan)" }}>◇</span> Filtros
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <SearchableSelect multiple className={selectClass} value={campaigns} options={filtersData?.campaigns ?? []}
                    emptyLabel="Todas as campanhas" onChange={(v) => { setCampaigns(v); setAds([]); }} />
                  {/* As campanhas aparecem agrupadas por regra (lib/campaignGroups); só
                      admin edita as regras, que valem para todo mundo. */}
                  {isAdmin && (
                    <button onClick={() => setRulesOpen(true)} title="Editar os grupos de campanha"
                      className="shrink-0 px-2 py-2 rounded-lg border border-separator text-ink-3 hover:text-ink transition-colors text-[13px] leading-none">
                      ⚙
                    </button>
                  )}
                </div>
                <SearchableSelect multiple className={selectClass} value={ads} options={adOptions}
                  emptyLabel="Todos os anúncios" onChange={setAds} />
                <SearchableSelect multiple className={selectClass} value={platforms}
                  options={filtersData?.platforms ?? []} labelOf={platformLabel}
                  emptyLabel="Todas as plataformas" onChange={setPlatforms} />
                <SearchableSelect multiple className={selectClass} value={networks}
                  options={filtersData?.networks ?? []} labelOf={networkLabel}
                  emptyLabel="Todas as redes" onChange={setNetworks} />
                {networks.length > 0 && tab !== "campanhas" && (
                  <p className="text-[11px] text-ink-3 self-center">
                    Rede só filtra a aba Campanhas — região e idade/gênero não trazem a rede do Meta.
                  </p>
                )}
                <SearchableSelect multiple className={selectClass} value={objectives}
                  options={filtersData?.objectives ?? []}
                  emptyLabel="Todos os objetivos" onChange={setObjectives} />
                {/* Tipo de compra sai do objetivo, mas por campanha inteira (o servidor
                    resolve para campaign_id), senão a mesma campanha do Meta cairia em
                    tipos diferentes em Campanhas e em Região. */}
                <SearchableSelect multiple className={selectClass} value={buyingTypes}
                  options={filtersData?.buyingTypes ?? []}
                  emptyLabel="Todos os tipos de compra" onChange={setBuyingTypes} />
                {/* A classificação criativa está defasada (o job `creative_classifier` do repo
                    mysql parou), então em janelas recentes a lista vem vazia — o hint diz o
                    porquê em vez de deixar um dropdown vazio parecendo quebrado. Tema que sai
                    da janela continua visível no campo, porque ele desenha a partir do valor
                    selecionado, não das opções. */}
                <SearchableSelect multiple className={selectClass} value={temas}
                  options={(filtersData?.temas ?? []).map((t) => t.code)} labelOf={temaLabel}
                  emptyLabel="Todos os temas"
                  noOptionsHint="Nenhum tema classificado nesta janela; amplie o período"
                  onChange={setTemas} />
                <SearchableSelect multiple className={selectClass} value={accounts}
                  options={filtersData?.accounts ?? []}
                  emptyLabel="Todas as contas / agências" onChange={setAccounts} />
                <div className="md:col-span-2 flex flex-wrap gap-2.5 items-center">
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
                    de <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={dateClass} />
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
                    até <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={dateClass} />
                  </label>
                  {[7, 14, 30, 90].map((d) => (
                    <button key={d} className={pill(from === isoDaysAgo(d) && to === isoDaysAgo(0))}
                      onClick={() => { setFrom(isoDaysAgo(d)); setTo(isoDaysAgo(0)); }}>
                      {d} dias
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── Seletor de métrica (abas dimensionais) ── */}
          {tab !== "campanhas" && (
            <div className="flex flex-wrap items-center gap-2">
              {METRIC_KEYS.map((k) => (
                <button key={k} className={pill(metric === k)} onClick={() => setMetric(k)}>{METRICS[k].label}</button>
              ))}
              {/* fora da métrica de engajamento o interruptor não teria o que discriminar */}
              {metric === "engajamento" && <span className="ml-2">{engSwitch}</span>}
            </div>
          )}

          {/* ══ CAMPANHAS ══ */}
          {tab === "campanhas" && (
            <>
              <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {(kpis.length ? kpis : Array.from({ length: 6 }, () => null)).map((k, i) => (
                  <div key={k?.label ?? i} className="relative hud-panel rounded-[12px] px-4 py-3.5">
                    <div className="font-hud text-[9px] uppercase tracking-[0.22em] text-ink-3">{k?.label ?? "—"}</div>
                    <div className="mt-1 text-[20px] font-bold tabular-nums text-ink truncate"
                         style={{ textShadow: "0 0 14px color-mix(in srgb, var(--hud-cyan) 28%, transparent)" }}
                         title={k?.value}>
                      {loading && !k ? "…" : k?.value ?? "—"}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold tabular-nums" style={{ color: k?.deltaColor }}>{k?.delta ?? ""}</span>
                      {k && <Spark values={k.spark} />}
                    </div>
                  </div>
                ))}
              </section>

              <section className="hud-panel rounded-[12px] grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
                {ratios.map((r) => (
                  <div key={r.label} className="px-4 py-3 border-l border-separator">
                    <div className="font-hud text-[9px] uppercase tracking-[0.2em] text-ink-3">{r.label}</div>
                    <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">{r.value}</div>
                  </div>
                ))}
              </section>

              <div className="flex flex-wrap items-center gap-2">
                {(["dia", "semana", "mes"] as Gran[]).map((g) => (
                  <button key={g} className={pill(gran === g)} onClick={() => setGran(g)}>
                    {{ dia: "Diário", semana: "Semanal", mes: "Mensal" }[g]}
                  </button>
                ))}
                {/* no mobile o interruptor desce para cima do gráfico que ele controla */}
                <span className="ml-2 hidden lg:inline">{engSwitch}</span>
              </div>

              <section className="grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-4">
                {trendChart && <ChartWidget chart={trendChart} fill />}
                {engChart && (
                  <div className="flex flex-col gap-3 min-h-0">
                    <div className="lg:hidden">{engSwitch}</div>
                    <div className="flex-1 min-h-0"><ChartWidget chart={engChart} fill /></div>
                  </div>
                )}
              </section>

              <div className="flex flex-wrap gap-2">
                {METRIC_KEYS.map((k) => (
                  <button key={k} className={pill(metric === k)} onClick={() => setMetric(k)}>{METRICS[k].label}</button>
                ))}
              </div>

              <section className="grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-4">
                {scatterChart && <ChartWidget chart={scatterChart} fill />}
                <Observacoes items={aiInsights ?? observacoes} loading={aiLoading} ia={!!aiInsights} />
              </section>

              <section className={`${panel} overflow-hidden`}>
                <div className="px-4 md:px-6 pt-5 pb-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className={panelTitle} style={{ textShadow: "0 0 12px color-mix(in srgb, var(--hud-cyan) 35%, transparent)" }}>
                    <span style={{ color: "var(--hud-cyan)" }}>◇</span> Performance
                    {totals && (
                      <span className="normal-case tracking-normal tabular-nums text-ink-3" style={{ textShadow: "none" }}>
                        · {nf(tmode === "campanha" ? totals.campaigns : totals.ads)} {tmode === "campanha" ? "campanhas" : "anúncios"}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button className={pill(tmode === "campanha")} onClick={() => setTmode("campanha")}>Por campanha</button>
                    <button className={pill(tmode === "anuncio")} onClick={() => setTmode("anuncio")}>Por anúncio</button>
                    <button className={pill(byNetwork)} onClick={() => setByNetwork((v) => !v)}
                      title="Quebrar cada linha pela sub-rede: Meta em Facebook/Instagram, Google em YouTube/Busca">
                      Rede
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[10px] font-hud uppercase tracking-[0.16em] text-ink-3 border-b border-separator">
                        {(() => {
                          const th = (label: string, k: string, cls = "px-3 py-2.5 text-right") =>
                            <SortTh key={k} label={label} k={k} sort={perfSort} className={cls}
                              onSort={(key) => setPerfSort((c) => nextSort(c, key))} />;
                          return (<>
                            {th("Plataforma", "platform", "px-4 md:px-6 py-2.5")}
                            {byNetwork && th("Rede", "network", "px-3 py-2.5")}
                            {th(tmode === "campanha" ? "Campanha" : "Anúncio", "nome", "px-3 py-2.5 min-w-[260px]")}
                            {th("Investimento", "cost")}
                            {th("Impressões", "impressions")}
                            {th("CPM", "cpm")}
                            {th("Cliques", "clicks")}
                            {th("CPC", "cpc")}
                            {th("CTR", "ctr")}
                            {th("Engajamento", "engagement")}
                            {tableParts.map((p) => th(p.label, p.key))}
                            {th("CPE", "cpe")}
                            {th("Tx. Eng.", "txeng")}
                            {th("Visualizações", "videoViews")}
                            {th("CPV", "cpv")}
                            {th("VTR", "vtr")}
                            {th("25%", "p25")}
                            {th("50%", "p50")}
                            {th("75%", "p75")}
                            {th("95%", "p95")}
                            {th("100%", "p100")}
                            {th("Completa", "completions", "px-3 py-2.5 pr-4 md:pr-6 text-right")}
                          </>);
                        })()}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r, i) => (
                        <tr key={`${r.platform}-${r.nome}-${i}`} className="border-b border-separator/60 hover:bg-fill/40">
                          <td className="px-4 md:px-6 py-3">
                            <span className="inline-flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ background: "var(--hud-cyan)", boxShadow: "0 0 8px var(--hud-cyan)" }} />
                              <span className="text-ink-3 text-[12px]">{platformLabel(r.platform)}</span>
                            </span>
                          </td>
                          {byNetwork && (
                            <td className="px-3 py-3 text-ink-2 text-[12px] whitespace-nowrap">{networkLabel(r.network)}</td>
                          )}
                          <td className="px-3 py-3 text-ink max-w-[320px]" title={r.nome}>
                            {r.nome || <span className="text-ink-3">sem nome</span>}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{brl(r.cost)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{nf(r.impressions)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{brl(div(r.cost, r.impressions) * 1000)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{nf(r.clicks)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r.clicks ? brl(div(r.cost, r.clicks)) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{pct(div(r.clicks, r.impressions) * 100)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{nf(r.engagement)}</td>
                          {tableParts.map((p) => (
                            <td key={p.key} className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r[p.key] ? nf(r[p.key]) : dash}</td>
                          ))}
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r.engagement ? brl(div(r.cost, r.engagement)) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{pct(div(r.engagement, r.impressions) * 100)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{nf(r.videoViews)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r.videoViews ? brl(div(r.cost, r.videoViews)) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{pct(div(r.videoViews, r.impressions) * 100)}</td>
                          {/* Quartis são CONTAGENS, como no Oracle — e um zero aqui quase
                              sempre é "a plataforma não reporta", não "ninguém assistiu". */}
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r.p25 ? nf(r.p25) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r.p50 ? nf(r.p50) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r.p75 ? nf(r.p75) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r.p95 ? nf(r.p95) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{r.p100 ? nf(r.p100) : dash}</td>
                          <td className="px-3 py-3 pr-4 md:pr-6 text-right tabular-nums whitespace-nowrap">{r.completions ? nf(r.completions) : dash}</td>
                        </tr>
                      ))}
                      {!tableRows.length && (
                        <tr><td colSpan={20 + tableParts.length + (byNetwork ? 1 : 0)} className="px-6 py-8 text-center text-ink-3">
                          {loading ? "Carregando…" : "Nenhum resultado para os filtros atuais."}
                        </td></tr>
                      )}
                    </tbody>
                    {/* Total das linhas que estão na tela; razões recalculadas dos
                        somatórios, nunca a média das razões de cada linha. */}
                    {tableRows.length > 0 && (
                      <tfoot className="sticky bottom-0 bg-surface-opaque">
                        <tr className="border-t border-separator font-semibold text-ink">
                          <td className="px-4 md:px-6 py-3 font-hud text-[10px] uppercase tracking-[0.16em]"
                              colSpan={byNetwork ? 3 : 2}>
                            Total · {nf(tableRows.length)} {tableRows.length === 1 ? "linha" : "linhas"}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{brl(tableTotal.cost)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{nf(tableTotal.impressions)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{brl(div(tableTotal.cost, tableTotal.impressions) * 1000)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{nf(tableTotal.clicks)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{tableTotal.clicks ? brl(div(tableTotal.cost, tableTotal.clicks)) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{pct(div(tableTotal.clicks, tableTotal.impressions) * 100)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{nf(tableTotal.engagement)}</td>
                          {tableParts.map((p) => (
                            <td key={p.key} className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{tableTotal[p.key] ? nf(tableTotal[p.key]) : dash}</td>
                          ))}
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{tableTotal.engagement ? brl(div(tableTotal.cost, tableTotal.engagement)) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{pct(div(tableTotal.engagement, tableTotal.impressions) * 100)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{nf(tableTotal.videoViews)}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{tableTotal.videoViews ? brl(div(tableTotal.cost, tableTotal.videoViews)) : dash}</td>
                          <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{pct(div(tableTotal.videoViews, tableTotal.impressions) * 100)}</td>
                          {(["p25", "p50", "p75", "p95", "p100", "completions"] as const).map((k) => (
                            <td key={k} className={`px-3 py-3 text-right tabular-nums whitespace-nowrap${k === "completions" ? " pr-4 md:pr-6" : ""}`}>
                              {tableTotal[k] ? nf(tableTotal[k]) : dash}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                <div className="px-4 md:px-6 py-3 text-[11px] text-ink-3 border-t border-separator">
                  {`${byNetwork
                    ? `${nf(tableRows.length)} linhas (${tmode === "campanha" ? "campanha" : "anúncio"} × rede), as maiores por investimento`
                    : `Os ${Math.min(tableRows.length, data?.limit ?? 50)} maiores por investimento`}, de ${nf(tmode === "campanha" ? (totals?.campaigns ?? 0) : (totals?.ads ?? 0))} ${tmode === "campanha" ? "campanhas" : "anúncios"}. Engajamento = curtidas + comentários + compartilhamentos + reações + salvos. Quartis e “completa” são contagens: 25–100% vêm de Meta, TikTok, GloboAds, Pinterest e Amazon, 95% só da Meta, e “completa” só de Kwai e LinkedIn — um traço significa que a plataforma não reporta.`}
                </div>
              </section>
            </>
          )}

          {/* ══ IDADE & GÊNERO ══ */}
          {tab === "demografia" && (
            <>
              <section className="grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-4">
                {ageChart && <ChartWidget chart={ageChart} fill />}
                {genderChart && <ChartWidget chart={genderChart} fill />}
              </section>
              {!ageChart && !loading && <Empty />}
              <Observacoes items={aiInsights ?? observacoes} loading={aiLoading} ia={!!aiInsights} />
              <p className="text-[11px] text-ink-3">
                As faixas são normalizadas: Kwai reporta 25 a 36 / 37 a 50 / 50+ e o TikTok 55 a 100, então os
                limites 34/44/55 são aproximados nessas plataformas. Só Meta, Google, TikTok e Kwai reportam idade e gênero.
              </p>
            </>
          )}

          {/* ══ REGIÃO ══ */}
          {tab === "regiao" && (
            <>
              {/* Discriminado, o ranking ganha 5 colunas e não cabe em meia tela:
                  mapa e tabela passam a ocupar a largura inteira, um sob o outro. */}
              <section className={`grid grid-cols-1 gap-4 items-start ${regiaoParts.length ? "" : "lg:grid-cols-2"}`}>
                {geoChart && <ChartWidget chart={geoChart} fill />}
                <div className={`${panel} overflow-hidden`}>
                  <div className="px-4 md:px-6 pt-5 pb-2">
                    <div className={panelTitle} style={{ textShadow: "0 0 12px color-mix(in srgb, var(--hud-cyan) 35%, transparent)" }}>
                      <span style={{ color: "var(--hud-cyan)" }}>◇</span> Ranking de estados
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-surface-opaque">
                        <tr className="text-left text-[10px] font-hud uppercase tracking-[0.16em] text-ink-3 border-b border-separator">
                          {(() => {
                            const th = (label: string, k: string, cls = "px-3 py-2.5 text-right") =>
                              <SortTh key={k} label={label} k={k} sort={regSort} className={cls}
                                onSort={(key) => setRegSort((c) => nextSort(c, key))} />;
                            return (<>
                              {th("UF", "uf", "px-4 md:px-6 py-2.5")}
                              {th("Estado", "estado", "px-3 py-2.5")}
                              {th(METRICS[metric].label, "value")}
                              {regiaoParts.map((p) => th(p.label, p.key))}
                            </>);
                          })()}
                          <th className="px-3 py-2.5 pr-4 md:pr-6 w-[150px]">{METRICS[metric].kind === "count" ? "Participação" : "Relativo"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regiaoSorted.map((r) => {
                          const isShare = METRICS[metric].kind === "count";
                          const total = regiaoRows.reduce((s, x) => s + finite(x.value), 0);
                          const max = finite(regiaoRows[0]?.value) || 1;
                          const v = finite(r.value);
                          return (
                            <tr key={r.uf} className="border-b border-separator/60 hover:bg-fill/40">
                              <td className="px-4 md:px-6 py-2.5 font-semibold text-accent-text">{r.uf}</td>
                              <td className="px-3 py-2.5 text-ink">{r.estado}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{fmtMetric(r.value, metric)}</td>
                              {regiaoParts.map((p) => (
                                <td key={p.key} className="px-3 py-2.5 text-right tabular-nums">{r[p.key] ? nf(r[p.key]) : dash}</td>
                              ))}
                              <td className="px-3 py-2.5 pr-4 md:pr-6">
                                <span className="flex items-center gap-2">
                                  <span className="flex-1 h-1.5 rounded-full bg-fill overflow-hidden block">
                                    <span className="block h-full rounded-full"
                                          style={{ width: `${(v / max) * 100}%`, background: "var(--hud-cyan)" }} />
                                  </span>
                                  <span className="text-[11px] text-ink-3 tabular-nums w-10 text-right">
                                    {isShare ? pct(div(v, total) * 100, 1) : dash}
                                  </span>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        {!regiaoRows.length && (
                          <tr><td colSpan={4 + regiaoParts.length} className="px-6 py-8 text-center text-ink-3">
                            {loading ? "Carregando…" : "Nenhum resultado para os filtros atuais."}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
              <Observacoes items={aiInsights ?? observacoes} loading={aiLoading} ia={!!aiInsights} />
              <p className="text-[11px] text-ink-3">
                Só Meta, Google, TikTok, Kwai e Amazon reportam região. Alcance e visualizações costumam vir zerados
                nesse grão — prefira impressões, cliques ou CTR aqui.
              </p>
            </>
          )}

          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-ink">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty() {
  return <div className="hud-panel rounded-[16px] px-6 py-10 text-center text-ink-3 text-[13px]">Nenhum resultado para os filtros atuais.</div>;
}

/** Leitura gerada pela IA sobre a métrica ativa; cai nas frases determinísticas se ela falhar. */
function Observacoes({ items, loading, ia }: { items: string[]; loading?: boolean; ia?: boolean }) {
  return (
    <div className="relative hud-panel hud-panel-gold rounded-[16px] px-4 py-5 md:px-6">
      <HudCorners accent="gold" size={16} inset={8} />
      <div className="font-hud text-[11px] uppercase tracking-[0.24em] text-ink flex items-center gap-2"
           style={{ textShadow: "0 0 12px color-mix(in srgb, var(--hud-gold) 35%, transparent)" }}>
        <span style={{ color: "var(--hud-gold)" }}>⚛</span> Leitura dos números
        {ia && !loading && (
          <span className="tracking-[0.18em] text-[9px] text-ink-3" style={{ textShadow: "none" }}>por IA</span>
        )}
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {!loading && !items.length && (
          <p className="text-[13px] leading-[1.6] text-ink-3 md:col-span-2">
            Sem achados para este recorte — poucos dados ou volume abaixo de 10 mil impressões por plataforma.
          </p>
        )}
        {loading
          ? [0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2.5">
                <span className="text-[11px] leading-[1.6] shrink-0 opacity-40" style={{ color: "var(--hud-gold)" }}>▸</span>
                <span className="block h-[13px] flex-1 animate-pulse rounded"
                      style={{ background: "var(--hud-gold-soft)", opacity: 0.35 }} />
              </div>
            ))
          : items.map((t) => (
              <div key={t} className="flex gap-2.5">
                <span className="text-[11px] leading-[1.6] shrink-0" style={{ color: "var(--hud-gold)" }}>▸</span>
                <p className="text-[13px] leading-[1.6] text-ink-2">{t}</p>
              </div>
            ))}
      </div>
      <Link href="/chat"
            className="mt-5 inline-flex items-center gap-2 font-hud text-[11px] uppercase tracking-[0.18em] transition-opacity hover:opacity-80"
            style={{ color: "var(--hud-gold)" }}>
        Perguntar ao Jarvis
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}
