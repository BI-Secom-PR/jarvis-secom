"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  LineChart,
  AreaChart,
  PieChart,
  Bar,
  Line,
  Area,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ChartData } from "@/types/chat";
import { CHART_HUES } from "@/lib/exports/chart-palette";

interface Props {
  chart: ChartData;
}

/* Series palettes from the shared hue table (lib/exports/chart-palette.ts):
   bright hues pop on dark; the deep print-safe variants carry light mode,
   matching the SVG/PDF export exactly. */
type SeriesColor = { stroke: string; from: string; to: string };
const DARK_PALETTE: SeriesColor[] = CHART_HUES.map((h) => ({ stroke: h.bright, from: h.bright, to: h.deep }));
const LIGHT_PALETTE: SeriesColor[] = CHART_HUES.map((h) => ({ stroke: h.deep, from: h.bright, to: h.deep }));

/* Tracks the resolved scheme: html.dark / html.light wins, otherwise the OS.
   Rendered client-only (ssr:false), so document is available on first render. */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === "undefined") return true;
    const cls = document.documentElement.classList;
    return cls.contains("dark") || (!cls.contains("light") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  });
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const compute = () =>
      setIsDark(root.classList.contains("dark") || (!root.classList.contains("light") && mq.matches));
    mq.addEventListener("change", compute);
    const obs = new MutationObserver(compute);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      mq.removeEventListener("change", compute);
      obs.disconnect();
    };
  }, []);
  return isDark;
}

/* pt-BR compact numbers: 1.234.567 → "1,2 Mi", 4.500 → "4,5 Mil" */
function formatCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Bi`;
  if (abs >= 1e6) return `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mi`;
  if (abs >= 1e3) return `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mil`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatFull(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  payload?: Record<string, unknown> & { fill?: string };
}

function GlassTooltip({
  active,
  payload,
  label,
  palette = DARK_PALETTE,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  palette?: SeriesColor[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-separator bg-surface-opaque px-3.5 py-2.5 shadow-(--shadow-modal) backdrop-blur-md">
      {label !== undefined && label !== "" && (
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          {label}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background: entry.color || entry.payload?.fill || palette[i % palette.length].stroke,
                boxShadow: `0 0 6px ${entry.color || palette[i % palette.length].stroke}66`,
              }}
            />
            <span className="text-ink-2">{entry.name}</span>
            <span className="ml-auto pl-4 font-semibold tabular-nums text-ink">
              {typeof entry.value === "number" ? formatFull(entry.value) : String(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendRow({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: it.color, boxShadow: `0 0 6px ${it.color}55` }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export default function ChartWidget({ chart }: Props) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<null | "png" | "print">(null);
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const isDark = useIsDark();
  const PALETTE = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  /* SVG presentation attributes can't resolve var(), so theme-dependent
     colors inside the chart are picked as literals from the active scheme */
  const AXIS_TICK = { fill: isDark ? "rgba(255,255,255,0.45)" : "rgba(60,60,67,0.55)", fontSize: 11 };
  const GRID = { stroke: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)" };
  const dotStroke = isDark ? "#0b0d1a" : "#ffffff";
  const cursorLine = { stroke: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)", strokeDasharray: "3 3" };

  const data = chart.labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label };
    chart.datasets.forEach((ds) => {
      row[ds.label] = ds.data[i] ?? 0;
    });
    return row;
  });

  const pieValues = chart.datasets[0]?.data ?? [];
  const pieSum = pieValues.reduce((s, v) => s + (v ?? 0), 0) || 1;
  const legendItems =
    chart.type === "pie"
      ? chart.labels.map((label, i) => ({
          label: `${label} · ${(((pieValues[i] ?? 0) / pieSum) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
          color: PALETTE[i % PALETTE.length].stroke,
        }))
      : chart.datasets.map((ds, i) => ({
          label: ds.label,
          color: PALETTE[i % PALETTE.length].stroke,
        }));
  const showLegend = chart.type === "pie" || chart.datasets.length > 1;

  const capturePng = async (): Promise<string | null> => {
    if (!captureRef.current) return null;
    const { toPng } = await import("html-to-image");
    return toPng(captureRef.current, {
      backgroundColor: isDark ? "#0b0d1a" : "#ffffff",
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
    } finally {
      setBusy(null);
    }
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
    } finally {
      setBusy(null);
    }
  };

  const btn =
    "px-3 py-2 md:px-2.5 md:py-1 text-[11px] rounded-md border border-separator bg-fill hover:bg-fill-2 text-ink-2 hover:text-ink transition disabled:opacity-50 disabled:cursor-not-allowed";

  const gradientDefs = (
    <defs>
      {PALETTE.map((c, i) => (
        <linearGradient key={i} id={`${gid}-bar-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.from} stopOpacity={0.95} />
          <stop offset="100%" stopColor={c.to} stopOpacity={0.45} />
        </linearGradient>
      ))}
      {PALETTE.map((c, i) => (
        <linearGradient key={`a${i}`} id={`${gid}-area-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.stroke} stopOpacity={0.32} />
          <stop offset="100%" stopColor={c.stroke} stopOpacity={0.02} />
        </linearGradient>
      ))}
      {PALETTE.map((c, i) => (
        <linearGradient key={`p${i}`} id={`${gid}-pie-${i}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c.from} stopOpacity={0.95} />
          <stop offset="100%" stopColor={c.to} stopOpacity={0.8} />
        </linearGradient>
      ))}
    </defs>
  );

  const xAxis = (
    <XAxis
      dataKey="name"
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={false}
      dy={8}
      interval="preserveStartEnd"
      minTickGap={24}
    />
  );
  const yAxis = (
    <YAxis
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={false}
      width={52}
      tickFormatter={formatCompact}
    />
  );
  const grid = <CartesianGrid strokeDasharray="3 6" vertical={false} {...GRID} />;
  const tooltip = (
    <Tooltip content={<GlassTooltip palette={PALETTE} />} cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }} />
  );

  const pieTotal = pieValues.reduce((s, v) => s + (v ?? 0), 0);

  const renderChart = () => {
    switch (chart.type) {
      case "line":
        return (
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {gradientDefs}
            {grid}
            {xAxis}
            {yAxis}
            <Tooltip content={<GlassTooltip palette={PALETTE} />} cursor={cursorLine} />
            {chart.datasets.map((ds, i) => {
              const c = PALETTE[i % PALETTE.length];
              return (
                <Line
                  key={ds.label}
                  type="monotone"
                  dataKey={ds.label}
                  stroke={c.stroke}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4.5, fill: c.stroke, stroke: dotStroke, strokeWidth: 2 }}
                  style={{ filter: `drop-shadow(0 0 5px ${c.stroke}59)` }}
                />
              );
            })}
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {gradientDefs}
            {grid}
            {xAxis}
            {yAxis}
            <Tooltip content={<GlassTooltip palette={PALETTE} />} cursor={cursorLine} />
            {chart.datasets.map((ds, i) => {
              const c = PALETTE[i % PALETTE.length];
              return (
                <Area
                  key={ds.label}
                  type="monotone"
                  dataKey={ds.label}
                  stroke={c.stroke}
                  strokeWidth={2.5}
                  fill={`url(#${gid}-area-${i})`}
                  dot={false}
                  activeDot={{ r: 4.5, fill: c.stroke, stroke: dotStroke, strokeWidth: 2 }}
                  style={{ filter: `drop-shadow(0 0 5px ${c.stroke}59)` }}
                />
              );
            })}
          </AreaChart>
        );
      case "pie": {
        const pieData = chart.labels.map((label, i) => ({
          name: label,
          value: chart.datasets[0]?.data[i] ?? 0,
        }));
        return (
          <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
            {gradientDefs}
            <Tooltip content={<GlassTooltip palette={PALETTE} />} />
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2.5}
              cornerRadius={6}
              stroke="none"
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={`url(#${gid}-pie-${i % PALETTE.length})`} />
              ))}
            </Pie>
            <text
              x="50%"
              y="47%"
              textAnchor="middle"
              fill={isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)"}
              fontSize={20}
              fontWeight={700}
            >
              {formatCompact(pieTotal)}
            </text>
            <text
              x="50%"
              y="56%"
              textAnchor="middle"
              fill={isDark ? "rgba(255,255,255,0.4)" : "rgba(60,60,67,0.45)"}
              fontSize={10.5}
              letterSpacing="0.08em"
            >
              TOTAL
            </text>
          </PieChart>
        );
      }
      default:
        return (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
            {gradientDefs}
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            {chart.datasets.map((ds, i) => (
              <Bar
                key={ds.label}
                dataKey={ds.label}
                fill={`url(#${gid}-bar-${i % PALETTE.length})`}
                radius={[6, 6, 2, 2]}
                maxBarSize={44}
              />
            ))}
          </BarChart>
        );
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-separator bg-fill p-3 md:p-4 shadow-(--shadow-bubble)">
      <div ref={captureRef} className="rounded-xl">
        {chart.title && (
          <div className="mb-3.5 flex items-center gap-2.5">
            <span className="h-4 w-1 rounded-full bg-gradient-to-b from-[#6ea8ff] to-[#7048e8]" />
            <p className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
              {chart.title}
            </p>
          </div>
        )}
        <ResponsiveContainer width="100%" height={chart.type === "pie" ? 260 : 248}>
          {renderChart()}
        </ResponsiveContainer>
        {showLegend && <LegendRow items={legendItems} />}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={btn} onClick={handleDownloadPng} disabled={busy !== null}>
          {busy === "png" ? "Gerando…" : "↓ PNG"}
        </button>
        <button
          type="button"
          className={btn}
          onClick={handlePrintPage}
          disabled={busy !== null}
          title="Abre uma página para imprimir ou salvar como PDF"
        >
          {busy === "print" ? "Gerando…" : "🖨 Imprimir / PDF"}
        </button>
      </div>
    </div>
  );
}
