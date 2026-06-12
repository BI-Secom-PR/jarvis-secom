"use client";

import { useEffect, useState } from "react";
import type { Theme } from "@/lib/theme";

const ORDER: Theme[] = ["system", "light", "dark"];

const LABEL: Record<Theme, string> = {
  system: "Tema: automático",
  light: "Tema: claro",
  dark: "Tema: escuro",
};

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (theme !== "system") root.classList.add(theme);
  document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
}

function AutoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      {/* half-filled circle = follows the system */}
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.55 1.55M17.15 17.15l1.55 1.55M5.3 18.7l1.55-1.55M17.15 6.85l1.55-1.55" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
    </svg>
  );
}

export default function ThemeToggle() {
  // The active theme lives on <html> (server-rendered from the cookie), so it
  // is read after mount instead of being threaded as a prop through every page.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const cls = document.documentElement.classList;
    setTheme(cls.contains("light") ? "light" : cls.contains("dark") ? "dark" : "system");
  }, []);

  function cycle() {
    if (!theme) return;
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      onClick={cycle}
      title={theme ? LABEL[theme] : "Tema"}
      aria-label={theme ? LABEL[theme] : "Tema"}
      className="flex items-center justify-center w-11 h-11 md:w-8 md:h-8 -my-1.5 rounded-xl text-ink-3 hover:text-ink-2 hover:bg-fill transition-colors cursor-pointer"
    >
      {theme === "light" ? <SunIcon /> : theme === "dark" ? <MoonIcon /> : <AutoIcon />}
    </button>
  );
}
