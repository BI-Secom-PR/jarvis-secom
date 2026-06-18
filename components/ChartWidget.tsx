"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  LineChart,
  AreaChart,
  PieChart,
  ScatterChart,
  Bar,
  Line,
  Area,
  Pie,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ChartData, ScatterPoint } from "@/types/chat";
import { PREMIUM_PALETTE } from "@/lib/exports/chart-palette";

interface Props {
  chart: ChartData;
}

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

/* Tooltip shared by bar/line/area/pie — premium dark card style */
interface TooltipEntry {
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  payload?: Record<string, unknown> & { fill?: string; __meta?: Record<string, string | number> };
}

function PremiumTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  const meta = payload[0]?.payload?.__meta;

  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        padding: "10px 14px",
        minWidth: 160,
      }}
    >
      {label !== undefined && label !== "" && (
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase" }}>
          {label}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {payload.map((entry, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                background: entry.color || PREMIUM_PALETTE[i % PREMIUM_PALETTE.length],
                boxShadow: `0 0 8px ${entry.color || PREMIUM_PALETTE[i % PREMIUM_PALETTE.length]}88`,
              }}
            />
            <span style={{ color: "rgba(255,255,255,0.65)" }}>{entry.name}</span>
            <span style={{ marginLeft: "auto", paddingLeft: 16, fontWeight: 600, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
              {typeof entry.value === "number" ? formatFull(entry.value) : String(entry.value ?? "")}
            </span>
          </div>
        ))}
      </div>

      {meta && Object.keys(meta).length > 0 && (
        <>
          <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "8px 0" }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "3px 12px" }}>
            {Object.entries(meta).map(([k, v]) => (
              <React.Fragment key={k}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{k}</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v}</span>
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* Tooltip for scatter chart — shows x/y + meta fields */
function ScatterTooltip({
  active,
  payload,
  xLabel,
  yLabel,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  xLabel?: string;
  yLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload as Record<string, unknown> | undefined;
  if (!pt) return null;

  const { x, y, __label, __meta, ...rest } = pt as {
    x?: number;
    y?: number;
    __label?: string;
    __meta?: Record<string, string | number>;
    [k: string]: unknown;
  };

  const color = payload[0]?.color ?? PREMIUM_PALETTE[0];
  const extraKeys = Object.keys(rest).filter((k) => !k.startsWith("__") && k !== "z");

  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        padding: "10px 14px",
        minWidth: 160,
      }}
    >
      {__label && (
        <p style={{ fontSize: 11, fontWeight: 600, color: "#fff", marginBottom: 6 }}>{__label}</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}88` }} />
          <span style={{ color: "rgba(255,255,255,0.5)" }}>{xLabel ?? "x"}</span>
          <span style={{ marginLeft: "auto", paddingLeft: 16, fontWeight: 600, color: "#fff" }}>{x}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "transparent" }} />
          <span style={{ color: "rgba(255,255,255,0.5)" }}>{yLabel ?? "y"}</span>
          <span style={{ marginLeft: "auto", paddingLeft: 16, fontWeight: 600, color: "#fff" }}>{y}</span>
        </div>
      </div>

      {(__meta || extraKeys.length > 0) && (
        <>
          <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "8px 0" }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "3px 12px" }}>
            {__meta
              ? Object.entries(__meta).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{k}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", textAlign: "right" }}>{v}</span>
                  </React.Fragment>
                ))
              : extraKeys.map((k) => (
                  <React.Fragment key={k}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{k}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", textAlign: "right" }}>{String(rest[k])}</span>
                  </React.Fragment>
                ))}
          </div>
        </>
      )}
    </div>
  );
}

/* Tooltip for geo chart */
function GeoTooltip({
  state,
  value,
  meta,
  metricLabel,
  color,
  isDark,
}: {
  state: string;
  value: number;
  meta?: Record<string, string | number>;
  metricLabel: string;
  color: string;
  isDark: boolean;
}) {
  return (
    <div
      style={{
        background: isDark ? "#0f172a" : "#ffffff",
        border: isDark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.08)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        padding: "10px 14px",
        minWidth: 150,
        pointerEvents: "none",
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 700, color: isDark ? "#fff" : "#0f172a", marginBottom: 6 }}>{state}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}88` }} />
        <span style={{ color: isDark ? "rgba(255,255,255,0.55)" : "rgba(60,60,67,0.55)" }}>{metricLabel}</span>
        <span style={{ marginLeft: "auto", paddingLeft: 16, fontWeight: 600, color: isDark ? "#fff" : "#0f172a" }}>{formatCompact(value)}</span>
      </div>
      {meta && Object.keys(meta).length > 0 && (
        <>
          <hr style={{ border: "none", borderTop: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.08)", margin: "8px 0" }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "3px 12px" }}>
            {Object.entries(meta).map(([k, v]) => (
              <React.Fragment key={k}>
                <span style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.4)" : "rgba(60,60,67,0.4)" }}>{k}</span>
                <span style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.75)" : "rgba(30,41,59,0.85)", textAlign: "right" }}>{v}</span>
              </React.Fragment>
            ))}
          </div>
        </>
      )}
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

/* Brazil geo choropleth — pure d3-geo SVG, no extra runtime deps */
interface GeoHoverState {
  uf: string;
  value: number;
  meta?: Record<string, string | number>;
  x: number;
  y: number;
}

interface GeoFeature {
  type: string;
  properties?: Record<string, unknown>;
  geometry: unknown;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function BrazilChoropleth({
  labels,
  values,
  metaMap,
  metricLabel,
  color,
  isDark,
}: {
  labels: string[];
  values: number[];
  metaMap: Record<string, Record<string, string | number> | undefined>;
  metricLabel: string;
  color: string;
  isDark: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ uf: string; d: string }[]>([]);
  const [hover, setHover] = useState<GeoHoverState | null>(null);
  const [hoveredUf, setHoveredUf] = useState<string | null>(null);

  const valueMap: Record<string, number> = {};
  labels.forEach((uf, i) => { valueMap[uf.toUpperCase()] = values[i] ?? 0; });
  const max = Math.max(...values, 1);

  function stateFill(uf: string, isHovered: boolean): string {
    const v = valueMap[uf.toUpperCase()];
    const ratio = v ? v / max : 0;
    const opacity = isDark
      ? (v ? 0.18 + ratio * 0.77 : 0.06)
      : (v ? 0.25 + ratio * 0.70 : 0.10);
    const base = hexToRgba(color, opacity);
    if (isHovered) return hexToRgba(color, Math.min(opacity + 0.2, 1));
    return base;
  }

  useEffect(() => {
    Promise.all([
      fetch("/brazil-states.geojson").then((r) => r.json()),
      import("d3-geo"),
    ]).then(([geo, d3]) => {
      const W = 560, H = 560;
      const projection = d3.geoMercator().fitSize([W, H], geo);
      const pathGen = d3.geoPath(projection);
      const result = (geo.features as GeoFeature[]).map((f) => ({
        uf: String(f.properties?.UF ?? f.properties?.sigla ?? ""),
        d: pathGen(f as Parameters<typeof pathGen>[0]) ?? "",
      }));
      setPaths(result);
    });
  }, []);

  if (!paths.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-[12px] text-ink-3">
        Carregando mapa…
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg viewBox="0 0 560 560" style={{ width: "100%", height: 300, borderRadius: 10, background: isDark ? "#0f172a" : "#f1f5f9" }}>
        {paths.map(({ uf, d }) => (
          <path
            key={uf}
            d={d}
            fill={stateFill(uf, hoveredUf === uf)}
            stroke={isDark ? "rgba(255,255,255,0.12)" : "rgba(30,41,59,0.18)"}
            strokeWidth={0.8}
            style={{ cursor: valueMap[uf.toUpperCase()] ? "pointer" : "default", transition: "fill 0.15s" }}
            onMouseEnter={(e) => {
              const containerRect = containerRef.current?.getBoundingClientRect();
              if (!containerRect) return;
              setHoveredUf(uf);
              setHover({
                uf,
                value: valueMap[uf.toUpperCase()] ?? 0,
                meta: metaMap[uf.toUpperCase()],
                x: e.clientX - containerRect.left,
                y: e.clientY - containerRect.top,
              });
            }}
            onMouseMove={(e) => {
              const containerRect = containerRef.current?.getBoundingClientRect();
              if (!containerRect) return;
              setHover((prev) => prev ? { ...prev, x: e.clientX - containerRect.left, y: e.clientY - containerRect.top } : prev);
            }}
            onMouseLeave={() => {
              setHoveredUf(null);
              setHover(null);
            }}
          />
        ))}
      </svg>
      {hover && (
        <div style={{ position: "absolute", left: Math.min(hover.x + 12, 260), top: Math.max(hover.y - 60, 0), zIndex: 50, pointerEvents: "none" }}>
          <GeoTooltip state={hover.uf} value={hover.value} meta={hover.meta} metricLabel={metricLabel} color={color} isDark={isDark} />
        </div>
      )}
    </div>
  );
}

export default function ChartWidget({ chart }: Props) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<null | "png" | "print">(null);
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const isDark = useIsDark();

  const AXIS_TICK = { fill: isDark ? "rgba(255,255,255,0.45)" : "rgba(60,60,67,0.55)", fontSize: 11 };
  const GRID = { stroke: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)" };
  const dotStroke = isDark ? "#0b0d1a" : "#ffffff";
  const cursorLine = { stroke: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)", strokeDasharray: "3 3" };

  /* Standard bar/line/area/pie data rows */
  const labels = chart.labels ?? [];
  const data = labels.map((label, i) => {
    const row: Record<string, string | number | Record<string, string | number>> = { name: label };
    chart.datasets.forEach((ds) => {
      row[ds.label] = (ds.data as number[])[i] ?? 0;
      if (ds.meta?.[i]) row["__meta"] = ds.meta[i];
    });
    return row;
  });

  const pieValues = (chart.datasets[0]?.data as number[]) ?? [];
  const pieSum = pieValues.reduce((s, v) => s + (v ?? 0), 0) || 1;
  const legendItems =
    chart.type === "pie"
      ? labels.map((label, i) => ({
          label: `${label} · ${(((pieValues[i] ?? 0) / pieSum) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
          color: PREMIUM_PALETTE[i % PREMIUM_PALETTE.length],
        }))
      : chart.type === "scatter"
      ? chart.datasets.map((ds, i) => ({ label: ds.label, color: PREMIUM_PALETTE[i % PREMIUM_PALETTE.length] }))
      : chart.datasets.map((ds, i) => ({ label: ds.label, color: PREMIUM_PALETTE[i % PREMIUM_PALETTE.length] }));
  const showLegend = chart.type === "pie" || chart.type === "scatter" || chart.datasets.length > 1;

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
      {PREMIUM_PALETTE.map((c, i) => (
        <linearGradient key={i} id={`${gid}-bar-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.90} />
          <stop offset="100%" stopColor={c} stopOpacity={0.20} />
        </linearGradient>
      ))}
      {PREMIUM_PALETTE.map((c, i) => (
        <linearGradient key={`a${i}`} id={`${gid}-area-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.32} />
          <stop offset="100%" stopColor={c} stopOpacity={0.02} />
        </linearGradient>
      ))}
      {PREMIUM_PALETTE.map((c, i) => (
        <linearGradient key={`p${i}`} id={`${gid}-pie-${i}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.95} />
          <stop offset="100%" stopColor={c} stopOpacity={0.70} />
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
    <Tooltip content={<PremiumTooltip />} cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }} />
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
            <Tooltip content={<PremiumTooltip />} cursor={cursorLine} />
            {chart.datasets.map((ds, i) => {
              const c = PREMIUM_PALETTE[i % PREMIUM_PALETTE.length];
              return (
                <Line
                  key={ds.label}
                  type="monotone"
                  dataKey={ds.label}
                  stroke={c}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4.5, fill: c, stroke: dotStroke, strokeWidth: 2 }}
                  style={{ filter: `drop-shadow(0 0 5px ${c}59)` }}
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
            <Tooltip content={<PremiumTooltip />} cursor={cursorLine} />
            {chart.datasets.map((ds, i) => {
              const c = PREMIUM_PALETTE[i % PREMIUM_PALETTE.length];
              return (
                <Area
                  key={ds.label}
                  type="monotone"
                  dataKey={ds.label}
                  stroke={c}
                  strokeWidth={2.5}
                  fill={`url(#${gid}-area-${i})`}
                  dot={false}
                  activeDot={{ r: 4.5, fill: c, stroke: dotStroke, strokeWidth: 2 }}
                  style={{ filter: `drop-shadow(0 0 5px ${c}59)` }}
                />
              );
            })}
          </AreaChart>
        );

      case "pie": {
        const pieData = labels.map((label, i) => ({
          name: label,
          value: (chart.datasets[0]?.data as number[])[i] ?? 0,
          __meta: chart.datasets[0]?.meta?.[i],
        }));
        return (
          <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
            {gradientDefs}
            <Tooltip content={<PremiumTooltip />} />
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
                <Cell key={i} fill={`url(#${gid}-pie-${i % PREMIUM_PALETTE.length})`} />
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

      case "scatter": {
        /* Build per-dataset point arrays with meta embedded */
        const scatterSeries = chart.datasets.map((ds, dsIdx) => ({
          color: PREMIUM_PALETTE[dsIdx % PREMIUM_PALETTE.length],
          label: ds.label,
          points: (ds.data as ScatterPoint[]).map((pt, ptIdx) => ({
            x: pt.x,
            y: pt.y,
            __label: ds.label,
            __meta: ds.meta?.[ptIdx],
          })),
        }));

        return (
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
            {gradientDefs}
            {grid}
            <XAxis
              type="number"
              dataKey="x"
              name={chart.xLabel ?? "x"}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCompact}
              label={chart.xLabel ? { value: chart.xLabel, position: "insideBottom", offset: -16, fill: AXIS_TICK.fill, fontSize: 11 } : undefined}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={chart.yLabel ?? "y"}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={formatCompact}
              label={chart.yLabel ? { value: chart.yLabel, angle: -90, position: "insideLeft", offset: 16, fill: AXIS_TICK.fill, fontSize: 11 } : undefined}
            />
            <ZAxis range={[48, 48]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)" }}
              content={<ScatterTooltip xLabel={chart.xLabel} yLabel={chart.yLabel} />}
            />
            {scatterSeries.map((s) => (
              <Scatter
                key={s.label}
                name={s.label}
                data={s.points}
                fill={s.color}
                style={{ filter: `drop-shadow(0 0 6px ${s.color}66)` }}
              />
            ))}
          </ScatterChart>
        );
      }

      case "geo": {
        const values = (chart.datasets[0]?.data as number[]) ?? [];
        const metaMap: Record<string, Record<string, string | number> | undefined> = {};
        (chart.labels ?? []).forEach((uf, i) => {
          metaMap[uf.toUpperCase()] = chart.datasets[0]?.meta?.[i];
        });
        return (
          <BrazilChoropleth
            labels={chart.labels ?? []}
            values={values}
            metaMap={metaMap}
            metricLabel={chart.datasets[0]?.label ?? "Valor"}
            color={PREMIUM_PALETTE[0]}
            isDark={isDark}
          />
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
                fill={`url(#${gid}-bar-${i % PREMIUM_PALETTE.length})`}
                radius={[6, 6, 2, 2]}
                maxBarSize={44}
              />
            ))}
          </BarChart>
        );
    }
  };

  const chartHeight = chart.type === "pie" ? 260 : chart.type === "geo" ? 310 : chart.type === "scatter" ? 280 : 248;

  return (
    <div className="mt-3 rounded-2xl border border-separator bg-fill p-3 md:p-4 shadow-(--shadow-bubble)">
      <div ref={captureRef} className="rounded-xl">
        {chart.title && (
          <div className="mb-3.5 flex items-center gap-2.5">
            <span
              className="h-4 w-1 rounded-full"
              style={{ background: `linear-gradient(to bottom, ${PREMIUM_PALETTE[0]}, ${PREMIUM_PALETTE[2]})` }}
            />
            <p className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
              {chart.title}
            </p>
          </div>
        )}
        {chart.type === "geo" ? (
          renderChart()
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            {renderChart()}
          </ResponsiveContainer>
        )}
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
