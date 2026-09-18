"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

// useLayoutEffect avisa no servidor; o posicionamento do tooltip só acontece
// depois de um hover, que é sempre no cliente.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;
import { ChartData, ScatterPoint } from "@/types/chat";
import { getChartPalette, niceAxisMax } from "@/lib/exports/chart-palette";
import { useIsDark } from "@/lib/useIsDark";

interface Props {
  chart: ChartData;
  /** Stretch the card to fill its parent (dashboard grids with equal-height cells). */
  fill?: boolean;
}

type ChartThemeMode = "system" | "dark" | "light";

const VIEW_W = 340;
const VIEW_H = 170;

interface HoverState {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string | number; color?: string }[];
  meta?: Record<string, string | number>;
}

interface HudTheme {
  isDark: boolean;
  palette: string[];
  accent: string;
  panel: string;
  text: string;
  dim: string;
  axis: string;
  dotBg: string;
  glow: string;
  bg: string;
}

interface SeriesPoint {
  x: number;
  y: number;
  value: number;
  label: string;
}

interface GeoFeature { type: string; properties?: Record<string, unknown>; geometry: unknown }

function formatCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Bi`;
  if (abs >= 1e6) return `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mi`;
  if (abs >= 1e3) return `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} k`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatFull(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function asNumbers(data: number[] | ScatterPoint[] | undefined): number[] {
  if (!Array.isArray(data)) return [];
  return data.map((v) => typeof v === "number" ? v : 0);
}

function shortLabel(label: string, max = 5): string {
  return String(label).slice(0, max).toUpperCase();
}

function pathCurve(points: { x: number; y: number }[]): string {
  return points.map((p, i) => {
    if (i === 0) return `M${p.x},${p.y}`;
    const prev = points[i - 1];
    const dx = p.x - prev.x;
    return `C${prev.x + dx * 0.42},${prev.y} ${p.x - dx * 0.42},${p.y} ${p.x},${p.y}`;
  }).join(" ");
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function donutPath(cx: number, cy: number, ro: number, ri: number, start: number, end: number): string {
  // a full-circle arc has coincident endpoints and renders nothing — clamp just under 360°
  if (end - start >= 360) end = start + 359.99;
  const p1 = polar(cx, cy, ro, start);
  const p2 = polar(cx, cy, ro, end);
  const q1 = polar(cx, cy, ri, start);
  const q2 = polar(cx, cy, ri, end);
  const large = end - start > 180 ? 1 : 0;
  return `M${p1.x},${p1.y} A${ro},${ro} 0 ${large} 1 ${p2.x},${p2.y} L${q2.x},${q2.y} A${ri},${ri} 0 ${large} 0 ${q1.x},${q1.y} Z`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function themeVars(isDark: boolean): HudTheme {
  return {
    isDark,
    palette: getChartPalette(isDark),
    accent: isDark ? "#22d3ee" : "#0891b2",
    panel: isDark ? "rgba(4,17,29,0.96)" : "rgba(255,255,255,0.98)",
    text: isDark ? "rgba(226,232,240,0.92)" : "rgba(15,23,42,0.9)",
    dim: isDark ? "rgba(148,163,184,0.52)" : "rgba(71,85,105,0.62)",
    axis: isDark ? "rgba(34,211,238,0.17)" : "rgba(14,90,130,0.17)",
    dotBg: isDark ? "#030d15" : "#ffffff",
    glow: isDark ? "0 0 7px rgba(34,211,238,.48),0 0 22px rgba(34,211,238,.1)" : "none",
    bg: isDark ? "#030d15" : "#ffffff",
  };
}

function SvgDefs({ gid, theme }: { gid: string; theme: HudTheme }) {
  return (
    <defs>
      {theme.isDark && (
        <>
          <filter id={`${gid}-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id={`${gid}-soft-glow`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </>
      )}
      {theme.palette.map((c, i) => (
        <linearGradient key={`bar-${i}`} id={`${gid}-bar-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={theme.isDark ? 0.82 : 0.6} />
          <stop offset="100%" stopColor={c} stopOpacity={theme.isDark ? 0.09 : 0.07} />
        </linearGradient>
      ))}
      {theme.palette.map((c, i) => (
        <linearGradient key={`area-${i}`} id={`${gid}-area-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={theme.isDark ? 0.42 : 0.26} />
          <stop offset="100%" stopColor={c} stopOpacity="0.01" />
        </linearGradient>
      ))}
      <linearGradient id={`${gid}-geo-legend`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stopColor={theme.accent} stopOpacity={theme.isDark ? 0.07 : 0.1} />
        <stop offset="100%" stopColor={theme.accent} stopOpacity="1" />
      </linearGradient>
    </defs>
  );
}

function GridLines({ pl, pr, pt, pb, max, theme, yTicks = true, xTicks = false }: { pl: number; pr: number; pt: number; pb: number; max: number; theme: HudTheme; yTicks?: boolean; xTicks?: boolean }) {
  const cW = VIEW_W - pl - pr;
  const cH = VIEW_H - pt - pb;
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = pt + cH * (1 - i / 4);
        const x = pl + cW * i / 4;
        return (
          <React.Fragment key={i}>
            <line x1={pl} y1={y} x2={pl + cW} y2={y} stroke={theme.axis} strokeWidth={i === 0 ? 1 : 0.5} strokeDasharray={i === 0 ? undefined : "3 6"} />
            {xTicks && <line x1={x} y1={pt} x2={x} y2={pt + cH} stroke={theme.axis} strokeWidth={i === 0 ? 1 : 0.5} strokeDasharray={i === 0 ? undefined : "2 5"} />}
            {yTicks && i > 0 && (
              <text x={pl - 4} y={y + 3.5} textAnchor="end" fill={theme.dim} fontSize="9" fontFamily="monospace">
                {formatCompact(max * i / 4)}
              </text>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function HudTooltip({ hover, theme }: { hover: HoverState | null; theme: HudTheme }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // O card tem overflow:hidden, então um tooltip que passa da borda é cortado.
  // Mede a caixa de verdade — a largura depende do conteúdo de `meta`, que pode
  // trazer nome de campanha — e vira para o outro lado do cursor quando não cabe.
  useBeforePaint(() => {
    const el = ref.current;
    if (!hover || !el) return;
    const host = el.offsetParent as HTMLElement | null;
    const hostW = host?.clientWidth ?? 0;
    const hostH = host?.clientHeight ?? 0;
    const { width, height } = el.getBoundingClientRect();
    let left = hover.x + 12;
    if (left + width > hostW) left = hover.x - 12 - width;      // vira para a esquerda
    left = Math.min(Math.max(left, 0), Math.max(hostW - width, 0));
    const top = Math.min(Math.max(hover.y - 58, 0), Math.max(hostH - height, 0));
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [hover]);

  if (!hover) return null;
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: pos?.left ?? hover.x + 12,
        top: pos?.top ?? Math.max(hover.y - 58, 0),
        zIndex: 50,
        pointerEvents: "none",
        background: theme.isDark ? "#030d15" : "#ffffff",
        border: `1px solid ${theme.isDark ? "rgba(34,211,238,.22)" : "rgba(14,90,130,.18)"}`,
        borderRadius: 3,
        boxShadow: theme.isDark ? "0 0 0 1px rgba(34,211,238,.06),0 8px 32px rgba(0,0,0,.72)" : "0 4px 24px rgba(0,0,0,.12)",
        minWidth: 170,
        maxWidth: 260,
        padding: "10px 12px",
        fontFamily: "monospace",
      }}
    >
      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".13em", color: theme.accent, marginBottom: 8, textTransform: "uppercase" }}>{hover.title}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {hover.rows.map((row) => (
          <div key={`${row.label}-${row.value}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: row.color ?? theme.accent, boxShadow: theme.isDark ? `0 0 6px ${row.color ?? theme.accent}88` : "none" }} />
            <span style={{ color: theme.dim }}>{row.label}</span>
            <span style={{ marginLeft: "auto", paddingLeft: 12, color: theme.text, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{typeof row.value === "number" ? formatFull(row.value) : row.value}</span>
          </div>
        ))}
      </div>
      {hover.meta && Object.keys(hover.meta).length > 0 && (
        <>
          <hr style={{ border: "none", borderTop: `1px solid ${theme.axis}`, margin: "8px 0" }} />
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px" }}>
            {Object.entries(hover.meta).map(([k, v]) => (
              <React.Fragment key={k}>
                <span style={{ color: theme.dim, fontSize: 10, whiteSpace: "nowrap" }}>{k}</span>
                <span style={{ color: theme.text, fontSize: 10, textAlign: "right", overflowWrap: "anywhere" }}>{typeof v === "number" ? formatFull(v) : String(v)}</span>
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LegendRow({ items, theme }: { items: { label: string; color: string }[]; theme: HudTheme }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {items.map((it) => (
        <span key={it.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", fontFamily: "monospace", color: theme.dim }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: it.color, boxShadow: theme.isDark ? `0 0 5px ${it.color}77` : "none", flexShrink: 0 }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function HudCorners({ theme }: { theme: HudTheme }) {
  const c = theme.isDark ? "#22d3ee" : "#0e5a82";
  const glow = theme.isDark ? `0 0 5px ${c}77` : "none";
  const base: React.CSSProperties = { position: "absolute", width: 13, height: 13, zIndex: 3, pointerEvents: "none" };
  return (
    <>
      <div style={{ ...base, top: -1, left: -1, borderTop: `2px solid ${c}`, borderLeft: `2px solid ${c}`, boxShadow: glow }} />
      <div style={{ ...base, top: -1, right: -1, borderTop: `2px solid ${c}`, borderRight: `2px solid ${c}`, boxShadow: glow }} />
      <div style={{ ...base, bottom: -1, left: -1, borderBottom: `2px solid ${c}`, borderLeft: `2px solid ${c}`, boxShadow: glow }} />
      <div style={{ ...base, bottom: -1, right: -1, borderBottom: `2px solid ${c}`, borderRight: `2px solid ${c}`, boxShadow: glow }} />
    </>
  );
}

function HudBar({ chart, gid, theme, setHover }: { chart: ChartData; gid: string; theme: HudTheme; setHover: (hover: HoverState | null) => void }) {
  const labels = chart.labels ?? [];
  // One dataset → one bar per label (the chat's shape, unchanged).
  // Two or more → grouped bars, one per dataset, coloured by SERIES not by
  // rank, so a filter that drops a category never repaints the survivors.
  const grouped = chart.datasets.length > 1;
  const series = chart.datasets.map((ds) => ({ label: ds.label, values: asNumbers(ds.data), meta: ds.meta }));
  // Empilhado: uma barra por label, dividida pelas séries — a altura total
  // continua sendo o total, e a escala é a do somatório da coluna.
  const stacked = !!chart.stacked && grouped;
  const sumTo = (i: number, upto: number) =>
    series.slice(0, upto + 1).reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
  const pl = 50, pr = 8, pt = 20, pb = 26;
  const cW = VIEW_W - pl - pr;
  const cH = VIEW_H - pt - pb;
  const max = niceAxisMax(stacked
    ? Math.max(...labels.map((_, i) => sumTo(i, series.length - 1)), 1)
    : Math.max(...series.flatMap((s) => s.values), 1));
  const gap = cW / Math.max(labels.length, 1);
  // 2px of surface between neighbouring bars keeps the groups legible
  const bW = grouped && !stacked
    ? Math.max(2, (gap * 0.72 - 2 * (series.length - 1)) / series.length)
    : Math.min(32, gap * 0.56);
  const groupW = grouped && !stacked ? bW * series.length + 2 * (series.length - 1) : bW;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-auto w-full" role="img" aria-label={chart.title ?? "Gráfico de barras"}>
      <SvgDefs gid={gid} theme={theme} />
      <GridLines pl={pl} pr={pr} pt={pt} pb={pb} max={max} theme={theme} />
      {labels.map((label, i) => {
        const gx = pl + i * gap + (gap - groupW) / 2;
        return (
          <g key={`${label}-${i}`}>
            {series.map((s, si) => {
              const value = s.values[i] ?? 0;
              const ci = grouped ? si : i;
              const color = theme.palette[ci % theme.palette.length];
              const h = max ? (value / max) * cH : 0;
              const x = stacked ? gx : gx + si * (bW + 2);
              const y = stacked ? pt + cH - (sumTo(i, si) / max) * cH : pt + cH - h;
              const hover = (e: React.MouseEvent) => setHover({
                x: e.nativeEvent.offsetX,
                y: e.nativeEvent.offsetY,
                title: String(label),
                rows: grouped
                  ? [
                      ...series.map((s2, k) => ({
                        label: s2.label,
                        value: s2.values[i] ?? 0,
                        color: theme.palette[k % theme.palette.length],
                      })),
                      ...(stacked ? [{ label: "Total", value: sumTo(i, series.length - 1), color: theme.accent }] : []),
                    ]
                  : [{ label: s.label ?? "Valor", value, color }],
                meta: s.meta?.[i],
              });
              return (
                <g key={si} onMouseEnter={hover} onMouseMove={hover} onMouseLeave={() => setHover(null)}>
                  {/* empilhado usa cor chapada: o gradiente some no rodapé de cada
                      segmento e deixaria a fatia de baixo aparecer por dentro */}
                  <rect x={x} y={y} width={bW} height={h} rx="1"
                    fill={stacked ? color : `url(#${gid}-bar-${ci % theme.palette.length})`}
                    fillOpacity={stacked ? (theme.isDark ? 0.72 : 0.55) : undefined}
                    filter={theme.isDark && !stacked ? `url(#${gid}-soft-glow)` : undefined} />
                  <line x1={x} y1={y + 0.7} x2={x + bW} y2={y + 0.7} stroke={color} strokeWidth="2" opacity={theme.isDark ? 0.88 : 0.65} />
                  {/* a value on every grouped bar is unreadable — the tooltip carries them */}
                  {!grouped && value > 0 && <text x={x + bW / 2} y={y - 4} textAnchor="middle" fill={theme.isDark ? color : theme.text} fontSize="9" fontWeight="700" fontFamily="monospace">{formatCompact(value)}</text>}
                </g>
              );
            })}
            <text x={gx + groupW / 2} y={VIEW_H - pb + 12} textAnchor="middle" fill={theme.dim} fontSize="8.5" fontFamily="monospace" letterSpacing=".04em">{shortLabel(String(label), grouped ? 5 : 4)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function HudLineArea({ chart, gid, theme, setHover, area }: { chart: ChartData; gid: string; theme: HudTheme; setHover: (hover: HoverState | null) => void; area: boolean }) {
  const labels = chart.labels ?? [];
  const series = chart.datasets.map((ds) => ({ label: ds.label, values: asNumbers(ds.data), meta: ds.meta }));
  const pl = area ? 48 : 44, pr = 10, pt = 12, pb = 24;
  const cW = VIEW_W - pl - pr;
  const cH = VIEW_H - pt - pb;
  const count = Math.max(labels.length, ...series.map((s) => s.values.length), 1);
  // Empilhado: cada série plota na soma acumulada até ela, e a escala é a do
  // somatório da coluna — o topo da pilha é o total, que é o número que o
  // gráfico mostrava antes de discriminar.
  const stacked = !!chart.stacked && series.length > 1;
  const sumTo = (i: number, upto: number) =>
    series.slice(0, upto + 1).reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
  const max = niceAxisMax(stacked
    ? Math.max(...Array.from({ length: count }, (_, i) => sumTo(i, series.length - 1)), 1)
    : Math.max(...series.flatMap((s) => s.values), 1));
  const labelAt = (i: number) => labels[i] ?? `P${i + 1}`;
  // Hover responde pela coluna inteira: todas as séries naquele x. Só empilhado
  // ganha a linha "Total" — sem pilha não existe soma que signifique alguma coisa
  // (alcance + impressões não é um número).
  const columnRows = (i: number) => [
    ...series.map((s, k) => ({ label: s.label, value: s.values[i] ?? 0, color: theme.palette[k % theme.palette.length] })),
    ...(stacked ? [{ label: "Total", value: sumTo(i, series.length - 1), color: theme.accent }] : []),
  ];

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-auto w-full" role="img" aria-label={chart.title ?? (area ? "Gráfico de área" : "Gráfico de linha")}>
      <SvgDefs gid={gid} theme={theme} />
      <GridLines pl={pl} pr={pr} pt={pt} pb={pb} max={max} theme={theme} />
      {Array.from({ length: count }).map((_, i) => {
        // Thin to ~6 evenly-spaced ticks (always keeping the last) so dense
        // series (weekly/daily trends) don't render overlapping labels — the
        // line/area itself still plots every point, only text is skipped.
        const step = Math.max(1, Math.ceil(count / 6));
        if (i % step !== 0 && i !== count - 1) return null;
        const x = count === 1 ? pl + cW / 2 : pl + i * (cW / (count - 1));
        // max 5 (not 4): "dd/mm" and double-digit-month "m/aa" (e.g. "12/26") both need the 5th char
        return <text key={i} x={x} y={VIEW_H - pb + 12} textAnchor="middle" fill={theme.dim} fontSize="8.5" fontFamily="monospace">{shortLabel(labelAt(i), 5)}</text>;
      })}
      {[...series].reverse().map((s, reverseIdx) => {
        const si = series.length - 1 - reverseIdx;
        const color = theme.palette[si % theme.palette.length];
        const points: SeriesPoint[] = s.values.map((value, i) => ({
          x: count === 1 ? pl + cW / 2 : pl + i * (cW / (count - 1)),
          y: pt + cH - ((stacked ? sumTo(i, si) : value) / max) * cH,
          value,
          label: labelAt(i),
        }));
        if (!points.length) return null;
        const d = pathCurve(points);
        const fillId = `${gid}-area-${si % theme.palette.length}`;
        const closed = `${d} L${points[points.length - 1].x},${pt + cH} L${points[0].x},${pt + cH} Z`;
        return (
          <g key={s.label}>
            {stacked ? (
              // As séries são desenhadas de cima para baixo (o loop já vem
              // invertido), então cada faixa visível é a banda entre duas curvas.
              // O fundo opaco vai antes da cor: sem ele a faixa de baixo herdaria
              // o alfa de todas as de cima e sairia com a cor errada.
              <>
                <path d={closed} fill={theme.bg} stroke="none" />
                <path d={closed} fill={color} fillOpacity={theme.isDark ? 0.5 : 0.34} stroke="none" />
              </>
            ) : (area || chart.type === "line") && <path d={closed} fill={`url(#${fillId})`} stroke="none" />}
            {theme.isDark && <path d={d} fill="none" stroke={color} strokeWidth={area ? 4 : 5} opacity={area ? 0.2 : 0.16} filter={`url(#${gid}-glow)`} strokeLinecap="round" />}
            <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((p, i) => (
              <g key={`${s.label}-${i}`} onMouseEnter={(e) => setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, title: p.label, rows: columnRows(i), meta: s.meta?.[i] })} onMouseMove={(e) => setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, title: p.label, rows: columnRows(i), meta: s.meta?.[i] })} onMouseLeave={() => setHover(null)}>
                <circle cx={p.x} cy={p.y} r={area ? 3.5 : 4} fill={theme.dotBg} stroke={color} strokeWidth={area ? 1.5 : 1.8} />
                <circle cx={p.x} cy={p.y} r={area ? 1.6 : 1.8} fill={color} />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function HudDonut({ chart, gid, theme, setHover }: { chart: ChartData; gid: string; theme: HudTheme; setHover: (hover: HoverState | null) => void }) {
  const labels = chart.labels ?? [];
  const values = asNumbers(chart.datasets[0]?.data);
  const total = values.reduce((s, v) => s + v, 0) || 1;
  const cx = VIEW_W * 0.36;
  const cy = VIEW_H / 2;
  const ro = Math.min(VIEW_H * 0.43, 72);
  const ri = ro * 0.62;
  let angle = 0;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-auto w-full" role="img" aria-label={chart.title ?? "Gráfico de rosca"}>
      <SvgDefs gid={gid} theme={theme} />
      {theme.isDark && [ro + 7, ro + 14].map((r) => <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="rgba(34,211,238,.07)" strokeWidth="1" strokeDasharray="4 8" />)}
      {values.map((value, i) => {
        const start = angle;
        const sweep = value / total * 360;
        const end = start + sweep;
        angle = end;
        const color = theme.palette[i % theme.palette.length];
        const mid = polar(cx, cy, (ro + ri) / 2, start + sweep / 2);
        const pct = value / total * 100;
        return (
          <g key={`${labels[i]}-${i}`} onMouseEnter={(e) => setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, title: String(labels[i] ?? chart.datasets[0]?.label ?? "Valor"), rows: [{ label: chart.datasets[0]?.label ?? "Valor", value, color }, { label: "Share", value: `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, color }], meta: chart.datasets[0]?.meta?.[i] })} onMouseMove={(e) => setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, title: String(labels[i] ?? chart.datasets[0]?.label ?? "Valor"), rows: [{ label: chart.datasets[0]?.label ?? "Valor", value, color }, { label: "Share", value: `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, color }], meta: chart.datasets[0]?.meta?.[i] })} onMouseLeave={() => setHover(null)}>
            <path d={donutPath(cx, cy, ro, ri, start, end)} fill={color} opacity={theme.isDark ? 0.82 : 0.72} stroke={theme.bg} strokeWidth="1.8" filter={theme.isDark ? `url(#${gid}-soft-glow)` : undefined} />
            {pct >= 8 && <text x={mid.x} y={mid.y + 3.5} textAnchor="middle" fill={theme.isDark ? theme.bg : "#fff"} fontSize="9" fontWeight="700" fontFamily="monospace">{pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</text>}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={ri - 2} fill={theme.bg} />
      <text x={cx} y={cy + 2} textAnchor="middle" fill={theme.palette[0]} fontSize="12" fontWeight="700" fontFamily="monospace">{formatCompact(total)}</text>
      <text x={cx} y={cy + 13} textAnchor="middle" fill={theme.dim} fontSize="7" letterSpacing=".15em" fontFamily="monospace">TOTAL</text>
      {labels.slice(0, 7).map((label, i) => {
        const color = theme.palette[i % theme.palette.length];
        const y = VIEW_H * 0.08 + i * (VIEW_H * 0.84 / Math.min(labels.length, 7)) + (VIEW_H * 0.84 / Math.min(labels.length, 7)) / 2;
        return (
          <g key={`${label}-side`}>
            <circle cx={VIEW_W * 0.63} cy={y} r="3.8" fill={color} filter={theme.isDark ? `url(#${gid}-soft-glow)` : undefined} />
            <text x={VIEW_W * 0.63 + 9} y={y - 2} fill={theme.text} opacity=".72" fontSize="9" fontFamily="monospace" letterSpacing=".04em">{shortLabel(String(label), 12)}</text>
            <text x={VIEW_W * 0.63 + 9} y={y + 10} fill={theme.isDark ? color : "rgba(30,41,59,.45)"} fontSize="8.5" fontFamily="monospace" fontWeight="700">{((values[i] ?? 0) / total * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</text>
          </g>
        );
      })}
    </svg>
  );
}

function HudScatter({ chart, gid, theme, setHover }: { chart: ChartData; gid: string; theme: HudTheme; setHover: (hover: HoverState | null) => void }) {
  const pl = 62, pr = 14, pt = 12, pb = 28;
  const cW = VIEW_W - pl - pr;
  const cH = VIEW_H - pt - pb;
  const series = chart.datasets.map((ds, dsIdx) => ({
    label: ds.label,
    color: theme.palette[dsIdx % theme.palette.length],
    meta: ds.meta,
    points: (ds.data as ScatterPoint[]).map((p, i) => ({ x: Number(p?.x), y: Number(p?.y), i })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  }));
  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const minX = Math.min(...allX, 0);
  const maxX = niceAxisMax(Math.max(...allX, 1));
  const maxY = niceAxisMax(Math.max(...allY, 1));

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-auto w-full" role="img" aria-label={chart.title ?? "Gráfico de dispersão"}>
      <SvgDefs gid={gid} theme={theme} />
      <GridLines pl={pl} pr={pr} pt={pt} pb={pb} max={maxY} theme={theme} yTicks={false} xTicks />
      {[0, 1, 2, 3].map((i) => {
        const y = pt + cH * i / 4;
        const x = pl + cW * i / 4;
        return (
          <React.Fragment key={i}>
            <text x={pl - 3} y={y + 3.5} textAnchor="end" fill={theme.dim} fontSize="8.5" fontFamily="monospace">{formatCompact(maxY * (4 - i) / 4)}</text>
            <text x={x} y={VIEW_H - pb + 12} textAnchor="middle" fill={theme.dim} fontSize="8.5" fontFamily="monospace">{formatCompact(minX + (maxX - minX) * i / 4)}</text>
          </React.Fragment>
        );
      })}
      {chart.xLabel && <text x={pl + cW / 2} y={VIEW_H - 2} textAnchor="middle" fill={theme.dim} fontSize="8.5" fontFamily="monospace" letterSpacing=".08em">{chart.xLabel.toUpperCase()}</text>}
      {chart.yLabel && <text x="13" y={pt + cH / 2} textAnchor="middle" fill={theme.dim} fontSize="8.5" fontFamily="monospace" transform={`rotate(-90,13,${pt + cH / 2})`}>{chart.yLabel.toUpperCase()}</text>}
      {series.map((s) => (
        <g key={s.label}>
          {s.points.map((p) => {
            const px = pl + ((p.x - minX) / Math.max(maxX - minX, 1)) * cW;
            const py = pt + cH - (p.y / maxY) * cH;
            return (
              <g key={`${s.label}-${p.i}`} onMouseEnter={(e) => setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, title: s.label, rows: [{ label: chart.xLabel ?? "x", value: p.x, color: s.color }, { label: chart.yLabel ?? "y", value: p.y, color: s.color }], meta: s.meta?.[p.i] })} onMouseMove={(e) => setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, title: s.label, rows: [{ label: chart.xLabel ?? "x", value: p.x, color: s.color }, { label: chart.yLabel ?? "y", value: p.y, color: s.color }], meta: s.meta?.[p.i] })} onMouseLeave={() => setHover(null)}>
                {theme.isDark && <circle cx={px} cy={py} r="8" fill={s.color} opacity=".18" filter={`url(#${gid}-glow)`} />}
                <circle cx={px} cy={py} r="5" fill={theme.dotBg} stroke={s.color} strokeWidth="1.8" />
                <circle cx={px} cy={py} r="2.2" fill={s.color} />
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

interface ZoomXform { scale: number; tx: number; ty: number }
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const clampNum = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

function clampPan(state: ZoomXform, box: { x: number; y: number; w: number; h: number }): ZoomXform {
  const { scale } = state;
  const minTx = box.x - (box.x + box.w) * scale;
  const maxTx = box.x + box.w - box.x * scale;
  const minTy = box.y - (box.y + box.h) * scale;
  const maxTy = box.y + box.h - box.y * scale;
  return { scale, tx: clampNum(state.tx, minTx, maxTx), ty: clampNum(state.ty, minTy, maxTy) };
}

function BrazilChoropleth({ chart, gid, theme, setHover }: { chart: ChartData; gid: string; theme: HudTheme; setHover: (hover: HoverState | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<{ uf: string; d: string; cx: number; cy: number }[]>([]);
  // viewBox recortado no bounding box do mapa — o Brasil é quase quadrado e
  // afogava num viewBox 2:1 fixo. A legenda vai por cima, no canto oceânico.
  const [box, setBox] = useState({ x: 0, y: 0, w: VIEW_W, h: VIEW_W });
  // Zoom/pan: transform aplicado só ao <g> dos estados, não à legenda — pinça
  // (2 ponteiros) e arrastar (1 ponteiro) via Pointer Events, sem lib nova.
  const [xform, setXform] = useState<ZoomXform>({ scale: 1, tx: 0, ty: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist0: number; scale0: number; origPivot: { x: number; y: number } } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);

  const toViewBoxPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const zoomAtViewBoxPoint = (vb: { x: number; y: number }, targetScale: number) => {
    setXform((prev) => {
      const nextScale = clampNum(targetScale, ZOOM_MIN, ZOOM_MAX);
      if (nextScale === prev.scale) return prev;
      const origX = (vb.x - prev.tx) / prev.scale;
      const origY = (vb.y - prev.ty) / prev.scale;
      return clampPan({ scale: nextScale, tx: vb.x - nextScale * origX, ty: vb.y - nextScale * origY }, box);
    });
  };

  const zoomCentered = (factor: number) => zoomAtViewBoxPoint({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, xform.scale * factor);

  const resetZoom = () => setXform({ scale: 1, tx: 0, ty: 0 });

  // React attaches `onWheel` as a passive listener by default, so preventDefault()
  // there is a silent no-op and the page scrolls instead of the map zooming.
  // A native listener is the documented workaround.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      zoomAtViewBoxPoint(toViewBoxPoint(e.clientX, e.clientY), xform.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [xform, box]);

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (xform.scale > 1) { resetZoom(); return; }
    zoomAtViewBoxPoint(toViewBoxPoint(e.clientX, e.clientY), 2.5);
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const vbMid = toViewBoxPoint(mid.x, mid.y);
      pinch.current = {
        dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale0: xform.scale,
        origPivot: { x: (vbMid.x - xform.tx) / xform.scale, y: (vbMid.y - xform.ty) / xform.scale },
      };
      panRef.current = null;
    } else if (pointers.current.size === 1) {
      panRef.current = toViewBoxPoint(e.clientX, e.clientY);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const targetVb = toViewBoxPoint(mid.x, mid.y);
      const nextScale = clampNum(pinch.current.scale0 * (dist / pinch.current.dist0), ZOOM_MIN, ZOOM_MAX);
      const { origPivot } = pinch.current;
      setXform(clampPan({ scale: nextScale, tx: targetVb.x - nextScale * origPivot.x, ty: targetVb.y - nextScale * origPivot.y }, box));
    } else if (pointers.current.size === 1 && panRef.current) {
      const vb = toViewBoxPoint(e.clientX, e.clientY);
      const dx = vb.x - panRef.current.x;
      const dy = vb.y - panRef.current.y;
      panRef.current = vb;
      if (xform.scale > 1) setXform((prev) => clampPan({ scale: prev.scale, tx: prev.tx + dx, ty: prev.ty + dy }, box));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      panRef.current = toViewBoxPoint(p.x, p.y);
    } else if (pointers.current.size === 0) {
      panRef.current = null;
    }
  };
  const labels = chart.labels ?? [];
  const values = asNumbers(chart.datasets[0]?.data);
  const valueMap: Record<string, number> = {};
  const metaMap: Record<string, Record<string, string | number> | undefined> = {};
  labels.forEach((uf, i) => {
    valueMap[String(uf).toUpperCase()] = values[i] ?? 0;
    metaMap[String(uf).toUpperCase()] = chart.datasets[0]?.meta?.[i];
  });
  const vals = Object.values(valueMap);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);

  useEffect(() => {
    Promise.all([
      fetch("/brazil-states.geojson").then((r) => r.json()),
      import("d3-geo"),
    ]).then(([geo, d3]) => {
      const projection = d3.geoMercator().fitSize([VIEW_W, VIEW_W], geo);
      const pathGen = d3.geoPath(projection);
      const [[x0, y0], [x1, y1]] = pathGen.bounds(geo as Parameters<typeof pathGen.bounds>[0]);
      setBox({ x: x0 - 3, y: y0 - 3, w: x1 - x0 + 6, h: y1 - y0 + 6 });
      const result = (geo.features as GeoFeature[]).map((f) => {
        const centroid = pathGen.centroid(f as Parameters<typeof pathGen>[0]);
        return {
          uf: String(f.properties?.UF ?? f.properties?.sigla ?? ""),
          d: pathGen(f as Parameters<typeof pathGen>[0]) ?? "",
          cx: centroid[0],
          cy: centroid[1],
        };
      });
      setPaths(result);
    });
  }, []);

  if (!paths.length) {
    return <div className="flex h-[220px] items-center justify-center text-[12px] text-ink-3">Carregando mapa...</div>;
  }

  const zoomBtn: React.CSSProperties = {
    width: 22,
    height: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 1,
    color: theme.accent,
    background: theme.panel,
    border: `1px solid ${theme.axis}`,
    borderRadius: 3,
    cursor: "pointer",
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="mx-auto block h-auto w-full max-h-[340px]"
        style={{ touchAction: xform.scale > 1 ? "none" : "pan-y", cursor: xform.scale > 1 ? "grab" : "default" }}
        role="img"
        aria-label={chart.title ?? "Mapa do Brasil"}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <SvgDefs gid={gid} theme={theme} />
        <g transform={`translate(${xform.tx} ${xform.ty}) scale(${xform.scale})`}>
          {paths.map(({ uf, d, cx, cy }) => {
            const value = valueMap[uf.toUpperCase()] ?? 0;
            const ratio = max === min ? (value ? 1 : 0) : (value - min) / (max - min);
            const fillOpacity = theme.isDark ? 0.05 + ratio * 0.78 : 0.07 + ratio * 0.65;
            const strokeOpacity = theme.isDark ? 0.25 + ratio * 0.55 : 0.2 + ratio * 0.45;
            return (
              <g key={uf} onMouseEnter={(e) => setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, title: uf, rows: [{ label: chart.datasets[0]?.label ?? "Valor", value, color: theme.accent }], meta: metaMap[uf.toUpperCase()] })} onMouseMove={(e) => setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, title: uf, rows: [{ label: chart.datasets[0]?.label ?? "Valor", value, color: theme.accent }], meta: metaMap[uf.toUpperCase()] })} onMouseLeave={() => setHover(null)}>
                <path d={d} fill={theme.accent} fillOpacity={fillOpacity} stroke={theme.accent} strokeOpacity={strokeOpacity} strokeWidth={(theme.isDark && ratio > 0.6 ? 0.9 : 0.6) / xform.scale} filter={theme.isDark && ratio > 0.5 ? `url(#${gid}-soft-glow)` : undefined} />
                {value > 0 && ratio > 0.32 && Number.isFinite(cx) && Number.isFinite(cy) && <text x={cx} y={cy + 4} textAnchor="middle" fill={theme.accent} fillOpacity={0.45 + ratio * 0.5} fontSize="11" fontFamily="monospace" fontWeight="700">{uf}</text>}
              </g>
            );
          })}
        </g>
        <rect x={box.x + box.w - 76} y={box.y + box.h - 8} width="72" height="5" fill={`url(#${gid}-geo-legend)`} rx="2" />
        <text x={box.x + box.w - 76} y={box.y + box.h - 11} fill={theme.dim} fontSize="9" fontFamily="monospace">BAIXO</text>
        <text x={box.x + box.w - 4} y={box.y + box.h - 11} textAnchor="end" fill={theme.dim} fontSize="9" fontFamily="monospace">ALTO</text>
      </svg>
      <div style={{ position: "absolute", top: 6, right: 6, display: "flex", flexDirection: "column", gap: 4 }}>
        <button type="button" style={zoomBtn} aria-label="Aumentar zoom" onClick={() => zoomCentered(1.5)}>+</button>
        <button type="button" style={zoomBtn} aria-label="Diminuir zoom" onClick={() => zoomCentered(1 / 1.5)}>−</button>
        {xform.scale !== 1 && <button type="button" style={zoomBtn} aria-label="Redefinir zoom" onClick={resetZoom}>⤾</button>}
      </div>
    </div>
  );
}

export default function ChartWidget({ chart, fill = false }: Props) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<null | "png" | "print">(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [chartThemeMode, setChartThemeMode] = useState<ChartThemeMode>("system");
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const appIsDark = useIsDark();
  const chartIsDark = chartThemeMode === "system" ? appIsDark : chartThemeMode === "dark";
  const baseTheme = themeVars(chartIsDark);
  // Semantic palettes (e.g. sentiment green/red/gray) override the categorical one.
  const theme = chart.colors?.length ? { ...baseTheme, palette: chart.colors } : baseTheme;

  const labels = chart.labels ?? [];
  const values = asNumbers(chart.datasets[0]?.data);
  const pieSum = values.reduce((s, v) => s + (v ?? 0), 0) || 1;
  const legendItems = chart.type === "pie"
    ? labels.map((label, i) => ({ label: `${label} · ${(((values[i] ?? 0) / pieSum) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, color: theme.palette[i % theme.palette.length] }))
    : chart.type === "bar" && chart.datasets.length === 1
      ? labels.map((label, i) => ({ label: String(label), color: theme.palette[i % theme.palette.length] }))
      : chart.datasets.map((ds, i) => ({ label: ds.label, color: theme.palette[i % theme.palette.length] }));
  const showLegend = chart.type === "pie" || chart.type === "scatter" || chart.type === "geo" || chart.datasets.length > 1;

  const capturePng = async (): Promise<string | null> => {
    if (!captureRef.current) return null;
    const { toPng } = await import("html-to-image");
    return toPng(captureRef.current, {
      backgroundColor: chartIsDark ? "#04111d" : "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
    });
  };

  const handleDownloadPng = async () => {
    if (busy) return;
    setBusy("png");
    try {
      const dataUrl = await capturePng();
      if (!dataUrl) return;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${(chart.title || "grafico").replace(/[^\w\-. ]+/g, "_").slice(0, 60)}.png`;
      a.click();
    } finally { setBusy(null); }
  };

  const handlePrintPage = async () => {
    if (busy) return;
    setBusy("print");
    try {
      const dataUrl = await capturePng();
      if (!dataUrl) return;
      const res = await fetch("/api/exports/from-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ png: dataUrl, title: chart.title || "Gráfico" }),
      });
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank");
    } finally { setBusy(null); }
  };

  const renderChart = () => {
    switch (chart.type) {
      case "line": return <HudLineArea chart={chart} gid={gid} theme={theme} setHover={setHover} area={false} />;
      case "area": return <HudLineArea chart={chart} gid={gid} theme={theme} setHover={setHover} area />;
      case "pie": return <HudDonut chart={chart} gid={gid} theme={theme} setHover={setHover} />;
      case "scatter": return <HudScatter chart={chart} gid={gid} theme={theme} setHover={setHover} />;
      case "geo": return <BrazilChoropleth chart={chart} gid={gid} theme={theme} setHover={setHover} />;
      default: return <HudBar chart={chart} gid={gid} theme={theme} setHover={setHover} />;
    }
  };

  const btn = "px-3 py-2 md:px-2.5 md:py-1 text-[10px] font-mono uppercase tracking-widest rounded-sm border border-separator bg-fill hover:bg-fill-2 text-ink-2 hover:text-ink transition disabled:opacity-50 disabled:cursor-not-allowed";
  const themeBtn = (mode: ChartThemeMode) =>
    `px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest rounded-sm border transition ${
      chartThemeMode === mode
        ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300"
        : "border-separator bg-fill text-ink-3 hover:bg-fill-2 hover:text-ink"
    }`;

  // O mapa (geo) tem altura ditada pela sua própria proporção (Brasil é mais
  // alto que largo) — esticá-lo com flex-1/h-full até a altura de um irmão no
  // grid (ex.: a tabela de ranking) fazia o overflow:hidden cortar o Sul.
  const isGeoFill = fill && chart.type === "geo";

  return (
    <div
      className={fill && !isGeoFill ? "flex-1 min-h-0 h-full flex flex-col" : isGeoFill ? "" : "mt-3"}
      style={{ width: fill ? "100%" : 630, maxWidth: "100%" }}
    >
      <div
        ref={captureRef}
        style={{
          ...(fill && !isGeoFill ? { flex: 1 } : {}),
          position: "relative",
          borderRadius: 2,
          border: `1px solid ${chartIsDark ? "rgba(34,211,238,.2)" : "rgba(14,90,130,.15)"}`,
          background: theme.panel,
          padding: "16px 16px 12px",
          boxShadow: chartIsDark
            ? "0 0 0 1px rgba(34,211,238,.06),0 8px 32px rgba(0,0,0,.72)"
            : "0 2px 12px rgba(0,0,0,.08),0 1px 3px rgba(0,0,0,.05)",
          overflow: "hidden",
        }}
      >
        <HudCorners theme={theme} />
        {chartIsDark && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, background: "repeating-linear-gradient(0deg,rgba(0,0,0,.04) 0,rgba(0,0,0,.04) 1px,transparent 1px,transparent 4px)" }} />}
        <div style={{ position: "relative", zIndex: 1 }}>
          {chart.title && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, paddingBottom: 9, borderBottom: `1px solid ${theme.axis}`, marginBottom: 13 }}>
              <span style={{ width: 6, height: 6, background: theme.accent, boxShadow: chartIsDark ? `0 0 6px ${theme.accent}77` : "none", transform: "rotate(45deg)", flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".13em", textTransform: "uppercase", fontFamily: "monospace", color: theme.accent, textShadow: chartIsDark ? `0 0 6px ${theme.accent}55` : "none" }}>
                {chart.title}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 7.5, letterSpacing: ".09em", textTransform: "uppercase", color: theme.dim, fontFamily: "monospace" }}>
                {chart.datasets[0]?.label ?? chart.type}
              </span>
            </div>
          )}
          <div style={{ position: "relative" }}>
            {renderChart()}
            <HudTooltip hover={hover} theme={theme} />
          </div>
          {showLegend && <LegendRow items={legendItems} theme={theme} />}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" aria-label="Tema do gráfico">
          <button type="button" className={themeBtn("system")} onClick={() => setChartThemeMode("system")} aria-pressed={chartThemeMode === "system"}>Auto</button>
          <button type="button" className={themeBtn("dark")} onClick={() => setChartThemeMode("dark")} aria-pressed={chartThemeMode === "dark"}>Dark</button>
          <button type="button" className={themeBtn("light")} onClick={() => setChartThemeMode("light")} aria-pressed={chartThemeMode === "light"}>Light</button>
        </div>
        <div className="flex justify-end gap-2">
        <button type="button" className={btn} onClick={handleDownloadPng} disabled={busy !== null}>
          {busy === "png" ? "Gerando..." : "↓ PNG"}
        </button>
        <button type="button" className={btn} onClick={handlePrintPage} disabled={busy !== null} title="Abre uma página para imprimir ou salvar como PDF">
          {busy === "print" ? "Gerando..." : "⎙ Imprimir / PDF"}
        </button>
        </div>
      </div>
    </div>
  );
}
