/**
 * Four L-shaped corner brackets — the signature Iron-Man HUD frame mark.
 * Drop inside any `relative` element. Accent is cyan or gold.
 */
export default function HudCorners({
  accent = "cyan",
  size = 14,
  inset = 4,
  insetb = -16,
}: {
  accent?: "cyan" | "gold";
  size?: number;
  inset?: number;
  insetb?: number;
}) {
  const color =
    accent === "gold" ? "rgba(255,181,61,0.55)" : "rgba(39,224,255,0.55)";
  const dim = { width: size, height: size };
  return (
    <>
      <span className="pointer-events-none absolute border-l border-t" style={{ ...dim, top: inset, left: inset, borderColor: color }} />
      <span className="pointer-events-none absolute border-r border-t" style={{ ...dim, top: inset, right: inset, borderColor: color }} />
      <span className="pointer-events-none absolute border-l border-b" style={{ ...dim, bottom: insetb, left: inset, borderColor: color }} />
      <span className="pointer-events-none absolute border-r border-b" style={{ ...dim, bottom: insetb, right: inset, borderColor: color }} />
    </>
  );
}
