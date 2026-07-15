/**
 * Four L-shaped corner brackets — the signature Iron-Man HUD frame mark.
 * Drop inside any `relative` element. Accent is cyan, gold, or violet.
 */
const ACCENT_COLORS = {
  cyan: "color-mix(in srgb, var(--hud-cyan) 55%, transparent)",
  gold: "color-mix(in srgb, var(--hud-gold) 55%, transparent)",
  violet: "color-mix(in srgb, var(--hud-violet) 55%, transparent)",
} as const;

export default function HudCorners({
  accent = "cyan",
  size = 14,
  inset = 4,
}: {
  accent?: keyof typeof ACCENT_COLORS;
  size?: number;
  inset?: number;
}) {
  const color = ACCENT_COLORS[accent];
  const dim = { width: size, height: size };
  return (
    <>
      <span className="pointer-events-none absolute border-l border-t" style={{ ...dim, top: inset, left: inset, borderColor: color }} />
      <span className="pointer-events-none absolute border-r border-t" style={{ ...dim, top: inset, right: inset, borderColor: color }} />
      <span className="pointer-events-none absolute border-l border-b" style={{ ...dim, bottom: inset, left: inset, borderColor: color }} />
      <span className="pointer-events-none absolute border-r border-b" style={{ ...dim, bottom: inset, right: inset, borderColor: color }} />
    </>
  );
}
