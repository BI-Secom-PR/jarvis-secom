/* Single source of truth for chart series colors.
   Premium palette: jewel tones that read well on dark and light backgrounds,
   independent of the app theme. Keep ChartWidget and chart-svg.ts in parity. */

export const PREMIUM_PALETTE = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#8b5cf6', // violet-500
  '#f59e0b', // amber-500
  '#f43f5e', // rose-500
  '#06b6d4', // cyan-500
];

/* Legacy — kept so existing chart-svg.ts compiles without changes until updated */
export interface ChartHue {
  bright: string;
  deep: string;
}

export const CHART_HUES: ChartHue[] = PREMIUM_PALETTE.map((c) => ({ bright: c, deep: c }));
