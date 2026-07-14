import Link from "next/link";
import HudCorners from "./HudCorners";

/**
 * HUD corner-bracket panel — generalizes the reference `.hud-box`. A glass
 * frame with a glowing accent left edge, ◇/⚛ glyphs, animated corner brackets,
 * and a light sweep along the top rail. Renders as a link when `href` is set.
 */

interface HudPanelProps {
  href?: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accent?: "cyan" | "gold" | "violet";
  className?: string;
  children?: React.ReactNode;
}

export default function HudPanel({
  href,
  title,
  subtitle,
  icon,
  accent = "cyan",
  className = "",
  children,
}: HudPanelProps) {
  const accentVar = `var(--hud-${accent})`;

  const body = (
    <>
      <HudCorners accent={accent} />

      {/* Top sweep rail */}
      <span className="absolute inset-x-0 top-0 h-px overflow-hidden">
        <span
          className="block h-full w-1/3 animate-hud-sweep motion-reduce:hidden"
          style={{
            background: `linear-gradient(90deg, transparent, ${accentVar}, transparent)`,
          }}
        />
      </span>

      {/* Diamond + atom glyphs */}
      <span
        className="absolute left-3 top-3 text-[15px] leading-none"
        style={{ color: accentVar, textShadow: `0 0 11px ${accentVar}` }}
      >
        ◇
      </span>
      <span className="absolute right-3 top-3 text-[16px] leading-none text-ink-4">
        ⚛
      </span>

      <div className="flex flex-col gap-2.5">
        {icon && (
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl border"
            style={{
              background: "color-mix(in srgb, " + accentVar + " 12%, transparent)",
              borderColor: "color-mix(in srgb, " + accentVar + " 40%, transparent)",
            }}
          >
            {icon}
          </div>
        )}
        <span
          className="font-hud text-[13px] font-bold uppercase tracking-[0.22em] text-ink"
          style={{ textShadow: "0 0 8px rgba(220,240,255,0.3)" }}
        >
          {title}
        </span>
        {subtitle && (
          <span className="text-[13px] leading-[1.55] tracking-[0.01em] text-ink-3">
            {subtitle}
          </span>
        )}
        {children}
      </div>
    </>
  );

  const panelClass = `group relative block rounded-[10px] px-11 py-4 hud-panel ${
    accent === "gold" ? "hud-panel-gold" : accent === "violet" ? "hud-panel-violet" : ""
  } transition-[box-shadow,transform] duration-300 ${className}`;

  if (href) {
    return (
      <Link
        href={href}
        className={`${panelClass} hover:-translate-y-0.5 active:scale-[0.99]`}
      >
        {body}
        <span className="mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-4 transition-colors group-hover:text-ink-2 font-hud">
          Acessar
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 6h7M6.5 3l3 3-3 3"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </Link>
    );
  }

  return <div className={panelClass}>{body}</div>;
}
