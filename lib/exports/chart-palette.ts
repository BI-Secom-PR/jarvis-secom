/* Single source of truth for chart series colors.
   Premium palette: jewel tones that read well on dark and light backgrounds,
   independent of the app theme. Keep ChartWidget and chart-svg.ts in parity. */

export const PREMIUM_PALETTE = [
  '#38bdf8', // sky-400   — electric blue
  '#f472b6', // pink-400  — hot pink
  '#2dd4bf', // teal-400  — mint
  '#fb923c', // orange-400 — coral
  '#a78bfa', // violet-400 — soft indigo
  '#4ade80', // green-400  — lime
];

/* Legacy — kept so existing chart-svg.ts compiles without changes until updated */
export interface ChartHue {
  bright: string;
  deep: string;
}

export const CHART_HUES: ChartHue[] = PREMIUM_PALETTE.map((c) => ({ bright: c, deep: c }));
