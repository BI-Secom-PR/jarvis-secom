// Categorical series palette, shared by ChartWidget and the SVG export path so
// a downloaded chart matches what was on screen.
//
// Both ramps are validated — do not hand-edit a hex. Re-run after any change:
//   node <dataviz-skill>/scripts/validate_palette.js "<hexes>" --mode dark  --surface "#070611"
//   node <dataviz-skill>/scripts/validate_palette.js "<hexes>" --mode light --surface "#f5f9fc"
// Both pass all six checks (lightness band, chroma floor, CVD separation,
// normal-vision floor, contrast) on the adjacent pairlist. The previous set
// (#22d3ee/#f97316/#818cf8/#4ade80/#fb923c/#94a3b8) failed dark: every step sat
// above the L≤0.67 band and #94a3b8 was under the chroma floor — it read gray.
//
// Forms where any two marks can end up side by side (scatter, bubble,
// choropleth, small multiples) only clear the all-pairs test with the FIRST
// THREE slots; past that, fold series into "Outras" or facet.
export const HUD_PALETTE_DARK = ['#01a2c5', '#da720d', '#9476ff', '#09af51', '#fe12a9', '#0c84fa'];
export const HUD_PALETTE_LIGHT = ['#0388a5', '#a36e09', '#804cfd', '#119245', '#d7068e', '#0278e7'];
export const getChartPalette = (isDark: boolean): string[] => isDark ? HUD_PALETTE_DARK : HUD_PALETTE_LIGHT;

/** Sequential ramp (single hue, light→dark) for magnitude — the choropleth. */
export const HUD_RAMP_DARK = ['#1c4f5c', '#20707f', '#01a2c5', '#5fd0e8', '#b7ecf7'];
export const HUD_RAMP_LIGHT = ['#5fb4d0', '#3396b6', '#15819e', '#0c576d', '#073744'];

// backward compat
export const PREMIUM_PALETTE = HUD_PALETTE_DARK;
export interface ChartHue { bright: string; deep: string }
export const CHART_HUES: ChartHue[] = PREMIUM_PALETTE.map((c) => ({ bright: c, deep: c }));
