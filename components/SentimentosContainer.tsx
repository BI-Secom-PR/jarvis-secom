"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HudBackground from "./HudBackground";
import HudCorners from "./HudCorners";
import ThemeToggle from "./ThemeToggle";
import ChartWidget from "./ChartWidget";
import { postJson } from "@/lib/fetchUtils";
import { SENTIMENTS } from "@/lib/sentimentos";
import type { ChartData } from "@/types/chat";

// Semantic sentiment colors (theme-independent, like the premium palette)
const SENT_COLORS: Record<string, string> = {
  Positivo: "#10b981",
  Negativo: "#ef4444",
  Neutro: "#8b95a5",
  "Sem classificação": "#5b6474",
};
const SENT_ORDER = ["Positivo", "Negativo", "Neutro", "Sem classificação"];

type FiltersData = {
  campaigns: string[];
  platforms: string[];
  ads: { campaign: string | null; ad: string }[];
};

type CommentRow = {
  id: number;
  image_url: string | null;
  post_message: string | null;
  comment: string | null;
  author: string | null;
  like_count: number | null;
  created_time: string | null;
  sentiment: string | null;
  sentiment_source: "ai" | "human" | null;
  audited_by: string | null;
  campaign_name: string | null;
  ad_name: string | null;
  platform: string;
};

type CountRow = { sentiment: string | null; n: number };
type DataResp = {
  distribution: CountRow[];
  trend: { ym: string; sentiment: string | null; n: number }[];
  byPlatform: { platform: string; sentiment: string | null; n: number }[];
  topNegative: { ad_name: string; n: number }[];
  topPositive: { ad_name: string; n: number }[];
  comments: CommentRow[];
  page: number;
  pageSize: number;
};

const sentLabel = (s: string | null) => s ?? "Sem classificação";
const truncate = (s: string | null | undefined, n: number) =>
  !s ? "—" : s.length > n ? s.slice(0, n - 1) + "…" : s;
// DB stores meta/instagram/tiktok; Meta ads = Facebook surface for users.
const PLATFORM_LABELS: Record<string, string> = {
  meta: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};
const platformLabel = (p: string | null | undefined) =>
  !p ? "—" : PLATFORM_LABELS[p.toLowerCase()] ?? p;

function Thumb({ url, onOpen }: { url: string | null; onOpen: (url: string) => void }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed)
    return (
      <div className="h-12 w-12 shrink-0 rounded-lg border border-separator bg-fill flex items-center justify-center text-ink-3">
        ◇
      </div>
    );
  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      aria-label="Ampliar criativo"
      className="group relative h-30 w-30 shrink-0 rounded-lg border border-separator overflow-hidden cursor-pointer p-0 focus:outline-none focus-visible:border-accent-border hover:border-accent-border transition-colors"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="criativo"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
      />
    </button>
  );
}

export default function SentimentosContainer({ userEmail }: { userEmail: string }) {
  const [filtersData, setFiltersData] = useState<FiltersData | null>(null);
  const [campaign, setCampaign] = useState("");
  const [ad, setAd] = useState("");
  const [platform, setPlatform] = useState("");
  const [sentiment, setSentiment] = useState("");
  // default window: last 14 days
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
  );
  const [to, setTo] = useState("");
  const [aiText, setAiText] = useState("");
  const [aiFilter, setAiFilter] = useState<{ where: string; descricao: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<DataResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topMode, setTopMode] = useState<"Negativo" | "Positivo">("Negativo");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState<{ w: number; h: number } | null>(null);

  const openPreview = useCallback((url: string) => {
    setPreviewFrame(null);
    setPreviewUrl(url);
  }, []);

  useEffect(() => {
    if (!previewUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewUrl]);

  // Debounced filters fetch + abort so rapid filter changes don't stack DB load.
  useEffect(() => {
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries({ from, to, campaign, ad, platform, sentiment }))
        if (v) qs.set(k, v);
      fetch(`/api/sentimentos/filters?${qs}`, { signal: ac.signal })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok || !Array.isArray(d?.campaigns) || !Array.isArray(d?.platforms) || !Array.isArray(d?.ads))
            throw new Error(d?.error ?? `HTTP ${r.status}`);
          return d as FiltersData;
        })
        .then((d) => {
          setFiltersData(d);
          // drop selections that fell out of the new option universe
          setCampaign((c) => (c && !d.campaigns.includes(c) ? "" : c));
          setAd((a) => (a && !d.ads.some((x) => x.ad === a) ? "" : a));
          setPlatform((p) => (p && !d.platforms.includes(p) ? "" : p));
        })
        .catch((e) => {
          if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
          setFiltersData({ campaigns: [], platforms: [], ads: [] });
        });
    }, 250);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [from, to, campaign, ad, platform, sentiment]);

  useEffect(() => {
    const ac = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await postJson(
          "/api/sentimentos/data",
          { campaign, ad, platform, sentiment, from, to, aiWhere: aiFilter?.where, page },
          { signal: ac.signal }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        // page > 0 responses carry only comments; keep the aggregates on screen
        setData((prev) => (prev && json.distribution === undefined ? { ...prev, ...json } : json));
      } catch (e) {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "Erro ao carregar dados");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [campaign, ad, platform, sentiment, from, to, aiFilter, page]);

  // server already facets the ads list by the other filters
  const adOptions = useMemo(
    () => [...new Set((filtersData?.ads ?? []).map((a) => a.ad))],
    [filtersData]
  );

  // distribution shares the comments query's WHERE, so its sum = total rows — no extra query
  const totalComments = useMemo(
    () => (data?.distribution ?? []).reduce((s, r) => s + Number(r.n), 0),
    [data]
  );
  const totalPages = Math.max(1, Math.ceil(totalComments / (data?.pageSize ?? 50)));

  async function applyAiFilter() {
    if (!aiText.trim()) return;
    setAiLoading(true);
    setError(null);
    try {
      const res = await postJson("/api/sentimentos/ai-filter", { text: aiText });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPage(0);
      setAiFilter(json);
      // AI-extracted sentiment/date range become normal filter state, so the
      // user can refine them with the existing dropdowns afterward.
      if (json.sentiment) setSentiment(json.sentiment);
      if (json.from) setFrom(json.from);
      if (json.to) setTo(json.to);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no filtro IA");
    } finally {
      setAiLoading(false);
    }
  }

  async function correct(row: CommentRow, newSentiment: string) {
    if (!data || newSentiment === row.sentiment) return;
    const prev = data;
    // optimistic
    setData({
      ...data,
      comments: data.comments.map((c) =>
        c.id === row.id
          ? { ...c, sentiment: newSentiment, sentiment_source: "human", audited_by: userEmail }
          : c
      ),
    });
    try {
      const res = await postJson("/api/sentimentos/correct", { id: row.id, sentiment: newSentiment });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    } catch (e) {
      setData(prev); // revert
      setError(e instanceof Error ? e.message : "Erro ao corrigir");
    }
  }

  // ── KPIs & charts ──
  const kpis = useMemo(() => {
    const dist = data?.distribution ?? [];
    const total = dist.reduce((s, r) => s + Number(r.n), 0);
    const get = (s: string) => Number(dist.find((r) => r.sentiment === s)?.n ?? 0);
    const pos = total ? (get("Positivo") / total) * 100 : 0;
    const neg = total ? (get("Negativo") / total) * 100 : 0;
    return { total, pos, neg, net: pos - neg };
  }, [data]);

  const donut: ChartData | null = useMemo(() => {
    if (!data?.distribution?.length) return null;
    const rows = SENT_ORDER.map((s) => ({
      label: s,
      n: Number(data.distribution.find((r) => sentLabel(r.sentiment) === s)?.n ?? 0),
    })).filter((r) => r.n > 0);
    return {
      type: "pie",
      title: "Distribuição de sentimentos",
      labels: rows.map((r) => r.label),
      datasets: [{ label: "Comentários", data: rows.map((r) => r.n) }],
      colors: rows.map((r) => SENT_COLORS[r.label]),
    };
  }, [data]);

  const trend: ChartData | null = useMemo(() => {
    if (!data?.trend?.length) return null;
    const yms = [...new Set(data.trend.map((r) => r.ym))].sort();
    const series = SENTIMENTS.filter((s) => data.trend.some((r) => r.sentiment === s));
    return {
      type: "line",
      title: "Evolução mensal por sentimento",
      // "m/aa" fits ChartWidget's 4-char axis labels ("2024-08" → "8/24")
      labels: yms.map((ym) => `${Number(ym.slice(5))}/${ym.slice(2, 4)}`),
      datasets: series.map((s) => ({
        label: s,
        data: yms.map((ym) => Number(data.trend.find((r) => r.ym === ym && r.sentiment === s)?.n ?? 0)),
      })),
      colors: series.map((s) => SENT_COLORS[s]),
    };
  }, [data]);

  // HudBar renders a single dataset (colored per label) — so one honest series:
  // share of negative comments per platform, with totals in the tooltip meta.
  const byPlatform: ChartData | null = useMemo(() => {
    if (!data?.byPlatform?.length) return null;
    const platforms = [...new Set(data.byPlatform.map((r) => r.platform))].sort();
    const rows = platforms.map((p) => {
      const of = (s: string) => Number(data.byPlatform.find((r) => r.platform === p && r.sentiment === s)?.n ?? 0);
      const total = data.byPlatform.filter((r) => r.platform === p).reduce((s, r) => s + Number(r.n), 0);
      return { p, total, neg: of("Negativo") };
    });
    return {
      type: "bar",
      title: "% de comentários negativos por plataforma",
      labels: rows.map((r) => platformLabel(r.p)),
      datasets: [{
        label: "% negativos",
        data: rows.map((r) => (r.total ? +((r.neg / r.total) * 100).toFixed(1) : 0)),
        meta: rows.map((r) => ({
          Total: r.total.toLocaleString("pt-BR"),
          Negativos: r.neg.toLocaleString("pt-BR"),
        })),
      }],
      colors: [SENT_COLORS.Negativo],
    };
  }, [data]);

  const topAds: ChartData | null = useMemo(() => {
    const rows = topMode === "Negativo" ? data?.topNegative : data?.topPositive;
    if (!rows?.length) return null;
    return {
      type: "bar",
      title: `Top anúncios — comentários ${topMode === "Negativo" ? "negativos" : "positivos"}`,
      labels: rows.map((r) => truncate(r.ad_name, 38)),
      datasets: [{ label: `Comentários ${topMode.toLowerCase()}s`, data: rows.map((r) => Number(r.n)) }],
      colors: [SENT_COLORS[topMode]],
    };
  }, [data, topMode]);

  const selectClass =
    "bg-fill border border-separator rounded-lg px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-accent-border appearance-none cursor-pointer w-full min-w-0 truncate";
  const dateClass =
    "bg-fill border border-separator rounded-lg px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-accent-border cursor-pointer";

  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden relative hud-theme hud-void-bg">
      <HudBackground variant="subtle" />

      <header className="relative z-10 shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 pb-3 md:pb-4 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-4 border-b border-separator">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            href="/"
            className="font-hud text-[10px] uppercase tracking-[0.2em] text-ink-3 hover:text-ink transition-colors py-3 -my-3 shrink-0"
          >
            Início
          </Link>
          <span className="text-ink-4 text-xs shrink-0">›</span>
          <h1
            className="font-hud text-[10px] uppercase tracking-[0.16em] text-ink truncate"
            style={{ textShadow: "0 0 10px color-mix(in srgb, var(--hud-cyan) 30%, transparent)" }}
          >
            Sentimentos
          </h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ThemeToggle />
          <span
            className="text-[15px] leading-none animate-hud-flicker motion-reduce:animate-none"
            style={{ color: "var(--hud-violet)", textShadow: "0 0 12px var(--hud-violet)" }}
          >
            ◇
          </span>
        </div>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-6 md:px-6 space-y-5">
          {/* ── Filtros ── */}
          <section className="relative hud-panel hud-panel-violet rounded-[16px] px-4 py-5 md:px-6">
            <HudCorners accent="violet" size={16} inset={8} />
            <div className="space-y-6">
              <div
                className="font-hud text-[11px] uppercase tracking-[0.24em] text-ink flex items-center gap-2"
                style={{ textShadow: "0 0 12px color-mix(in srgb, var(--hud-cyan) 35%, transparent)" }}
              >
                <span style={{ color: "var(--hud-violet)" }}>◇</span> Filtros
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 items-center">
                <select
                  className={selectClass}
                  value={campaign}
                  onChange={(e) => { setCampaign(e.target.value); setAd(""); setPage(0); }}
                >
                  <option value="">Todas as campanhas</option>
                  {filtersData?.campaigns.map((c) => (
                    <option key={c} value={c}>{truncate(c, 70)}</option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={ad}
                  onChange={(e) => { setAd(e.target.value); setPage(0); }}
                >
                  <option value="">Todos os anúncios</option>
                  {adOptions.map((a) => (
                    <option key={a} value={a}>{truncate(a, 70)}</option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={platform}
                  onChange={(e) => { setPlatform(e.target.value); setPage(0); }}
                >
                  <option value="">Todas as plataformas</option>
                  {filtersData?.platforms.map((p) => (
                    <option key={p} value={p}>{platformLabel(p)}</option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={sentiment}
                  onChange={(e) => { setSentiment(e.target.value); setPage(0); }}
                >
                  <option value="">Todos os sentimentos</option>
                  {SENTIMENTS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <div className="md:col-span-2 flex flex-wrap gap-2.5 items-center">
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
                    de
                    <input
                      type="date"
                      value={from}
                      max={to || undefined}
                      onChange={(e) => { setFrom(e.target.value); setPage(0); }}
                      className={dateClass}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
                    até
                    <input
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={(e) => { setTo(e.target.value); setPage(0); }}
                      className={dateClass}
                    />
                  </label>
                  {(from || to) && (
                    <button
                      onClick={() => { setFrom(""); setTo(""); setPage(0); }}
                      className="text-[12px] text-ink-3 hover:text-ink underline underline-offset-2"
                    >
                      limpar datas
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5 items-center">
                <input
                  type="text"
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyAiFilter()}
                  placeholder='Filtro em linguagem natural, ex.: "reclamações sobre preço de gasolina"'
                  className="flex-1 min-w-[240px] bg-fill border border-separator rounded-lg px-3 py-2 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent-border"
                />
                <button
                  onClick={applyAiFilter}
                  disabled={aiLoading || !aiText.trim()}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold border bg-accent-soft border-accent-border text-accent-text hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {aiLoading ? "Interpretando…" : "Filtrar com IA"}
                </button>
                {aiFilter && (
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] bg-accent-soft border border-accent-border text-accent-text max-w-full">
                    <span className="truncate" title={aiFilter.where}>IA: {aiFilter.descricao}</span>
                    <button
                      onClick={() => { setAiFilter(null); setPage(0); }}
                      className="hover:text-ink shrink-0"
                      aria-label="Remover filtro IA"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* ── KPIs ── */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Comentários", value: kpis.total.toLocaleString("pt-BR"), color: "var(--hud-violet)" },
              { label: "Positivos", value: `${kpis.pos.toFixed(1)}%`, color: SENT_COLORS.Positivo },
              { label: "Negativos", value: `${kpis.neg.toFixed(1)}%`, color: SENT_COLORS.Negativo },
              { label: "Net sentiment", value: `${kpis.net >= 0 ? "+" : ""}${kpis.net.toFixed(1)}`, color: kpis.net >= 0 ? SENT_COLORS.Positivo : SENT_COLORS.Negativo },
            ].map((k) => (
              <div key={k.label} className="relative hud-panel hud-panel-violet rounded-[12px] px-4 py-3.5">
                <div className="font-hud text-[9px] uppercase tracking-[0.22em] text-ink-3">{k.label}</div>
                <div
                  className="mt-1 text-[22px] font-bold tabular-nums"
                  style={{ color: k.color, textShadow: `0 0 14px color-mix(in srgb, ${k.color} 50%, transparent)` }}
                >
                  {loading ? "…" : k.value}
                </div>
              </div>
            ))}
          </section>

          {/* ── Gráficos ── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-4">
            {donut && <ChartWidget chart={donut} fill />}
            {trend && <ChartWidget chart={trend} fill />}
            {byPlatform && <ChartWidget chart={byPlatform} fill />}
            {topAds && (
              <div className="flex flex-col gap-2 min-h-0">
                <div className="flex gap-2 shrink-0">
                  {(["Negativo", "Positivo"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setTopMode(m)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${topMode === m
                        ? "bg-accent-soft border-accent-border text-accent-text"
                        : "bg-fill border-separator text-ink-3 hover:text-ink"
                        }`}
                    >
                      Mais {m === "Negativo" ? "negativos" : "positivos"}
                    </button>
                  ))}
                </div>
                <ChartWidget chart={topAds} fill />
              </div>
            )}
          </section>

          {/* ── Tabela de comentários ── */}
          <section className="relative hud-panel hud-panel-violet rounded-[16px] overflow-hidden">
            <HudCorners accent="violet" size={16} inset={8} />
            <div className="px-4 md:px-6 pt-5 pb-3 flex items-center justify-between gap-3">
              <div
                className="font-hud text-[11px] uppercase tracking-[0.24em] text-ink flex items-center gap-2"
                style={{ textShadow: "0 0 12px color-mix(in srgb, var(--hud-cyan) 35%, transparent)" }}
              >
                <span style={{ color: "var(--hud-violet)" }}>◇</span> Comentários
                {totalComments > 0 && (
                  <span className="normal-case tracking-normal tabular-nums text-ink-3" style={{ textShadow: "none" }}>
                    · {totalComments.toLocaleString("pt-BR")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[12px] text-ink-3">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                  className="px-2.5 py-1 rounded border border-separator bg-fill hover:text-ink disabled:opacity-40"
                >
                  ← Anterior
                </button>
                <span className="tabular-nums">página {page + 1} de {totalPages}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading || page + 1 >= totalPages}
                  className="px-2.5 py-1 rounded border border-separator bg-fill hover:text-ink disabled:opacity-40"
                >
                  Próxima →
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[10px] font-hud uppercase tracking-[0.16em] text-ink-3 border-b border-separator">
                    <th className="px-4 md:px-6 py-2.5 w-16">Imagem</th>
                    <th className="px-3 py-2.5 min-w-[220px]">Mensagem do anúncio</th>
                    <th className="px-3 py-2.5 min-w-[260px]">Comentário</th>
                    <th className="px-3 py-2.5 pr-4 md:pr-6 w-56 text-center">Classificação</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.comments ?? []).map((row) => (
                    <tr key={row.id} className="border-b border-separator/60 align-top hover:bg-fill/40">
                      <td className="px-4 md:px-6 py-3"><Thumb url={row.image_url} onOpen={openPreview} /></td>
                      <td className="px-3 py-3">
                        <p className="text-ink-2" title={row.post_message ?? undefined}>
                          {truncate(row.post_message, 140)}
                        </p>
                        <p className="mt-1 text-[11px] text-ink-3 truncate max-w-[280px]" title={`${row.campaign_name ?? ""} · ${row.ad_name ?? ""}`}>
                          {platformLabel(row.platform)} · {truncate(row.campaign_name, 45)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-ink" title={row.comment ?? undefined}>{truncate(row.comment, 200)}</p>
                        <p className="mt-1 text-[11px] text-ink-3">
                          {row.author ?? "anônimo"} · {row.like_count ?? 0} ♥
                          {row.created_time ? ` · ${new Date(row.created_time).toLocaleDateString("pt-BR")}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3 pr-4 md:pr-6 text-center align-middle">
                        <select
                          className={selectClass + " py-1 text-[12px] font-medium"}
                          style={{
                            color: SENT_COLORS[sentLabel(row.sentiment)],
                            borderColor: SENT_COLORS[sentLabel(row.sentiment)] + "66",
                            boxShadow: `0 0 10px ${SENT_COLORS[sentLabel(row.sentiment)]}40`,
                          }}
                          value={row.sentiment ?? ""}
                          onChange={(e) => correct(row, e.target.value)}
                        >
                          {!row.sentiment && <option value="">—</option>}
                          {SENTIMENTS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        {row.sentiment_source === "human" && (
                          <p className="mt-1.5 text-[10px] text-ink-3" title={row.audited_by ?? undefined}>
                            ✎ corrigido por {truncate(row.audited_by, 28)}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && !data?.comments.length && (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-ink-3">
                        Nenhum comentário para os filtros atuais.
                      </td>
                    </tr>
                  )}
                  {loading && (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-ink-3 animate-pulse">
                        Carregando…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4">
          <div className="bg-fill border border-separator-strong rounded-lg px-4 py-2.5 shadow-lg flex items-center gap-3 text-[13px] text-danger max-w-xl">
            <span className="min-w-0">{error}</span>
            <button onClick={() => setError(null)} className="text-ink-3 hover:text-ink shrink-0" aria-label="Fechar">
              ✕
            </button>
          </div>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Visualização do criativo"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewUrl(null);
          }}
        >
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 z-10 h-10 w-10 rounded-full border border-separator bg-fill/90 text-ink-2 hover:text-ink flex items-center justify-center"
            aria-label="Fechar"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="criativo ampliado"
            onError={() => setPreviewUrl(null)}
            onLoad={(e) => {
              const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget;
              if (!nw || !nh) return;
              // Normalize to common ad ratios so same-shaped creatives share a frame size.
              const r = nw / nh;
              const targetR =
                Math.abs(r - 1) <= 0.12 ? 1 :
                  r >= 1.5 ? 16 / 9 :
                    r <= 0.7 ? 9 / 16 :
                      r;
              const maxW = Math.min(window.innerWidth * 0.9, 1100);
              const maxH = window.innerHeight * 0.85;
              let w = maxW;
              let h = w / targetR;
              if (h > maxH) {
                h = maxH;
                w = h * targetR;
              }
              setPreviewFrame({ w: Math.round(w), h: Math.round(h) });
            }}
            style={previewFrame ? { width: previewFrame.w, height: previewFrame.h } : undefined}
            className="max-h-[85vh] max-w-[90vw] rounded-xl border border-separator object-contain shadow-lg bg-fill/40"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
