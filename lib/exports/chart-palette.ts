export const HUD_PALETTE_DARK = ['#22d3ee', '#f97316', '#818cf8', '#4ade80', '#fb923c', '#94a3b8'];
export const HUD_PALETTE_LIGHT = ['#0891b2', '#ea580c', '#6366f1', '#16a34a', '#d97706', '#475569'];
export const getChartPalette = (isDark: boolean): string[] => isDark ? HUD_PALETTE_DARK : HUD_PALETTE_LIGHT;

// backward compat
export const PREMIUM_PALETTE = HUD_PALETTE_DARK;
export interface ChartHue { bright: string; deep: string }
export const CHART_HUES: ChartHue[] = PREMIUM_PALETTE.map((c) => ({ bright: c, deep: c }));
