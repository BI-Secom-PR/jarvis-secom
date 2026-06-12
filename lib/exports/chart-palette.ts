/* Single source of truth for chart series hues.
   `bright` is the hue used on dark backgrounds (in-app dark mode),
   `deep` is the print-safe variant used on white (in-app light mode and the
   SVG/PDF export) — keep ChartWidget and chart-svg.ts in parity through this
   module instead of duplicating hex values. */

export interface ChartHue {
  bright: string;
  deep: string;
}

export const CHART_HUES: ChartHue[] = [
  { bright: '#6ea8ff', deep: '#3b5bdb' }, // electric blue
  { bright: '#b197fc', deep: '#7048e8' }, // violet
  { bright: '#3bd4c0', deep: '#0ca678' }, // teal
  { bright: '#f783ac', deep: '#d6336c' }, // magenta
  { bright: '#ffd43b', deep: '#f08c00' }, // amber
  { bright: '#66d9e8', deep: '#1098ad' }, // cyan
];
