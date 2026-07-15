"use client";

import { useEffect, useState } from "react";

/** True when the resolved scheme is dark: html .dark class, or OS dark without
 *  a forced .light class. Tracks toggle + OS changes live. */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === "undefined") return true;
    const cls = document.documentElement.classList;
    return cls.contains("dark") || (!cls.contains("light") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  });

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const compute = () => setIsDark(root.classList.contains("dark") || (!root.classList.contains("light") && mq.matches));
    mq.addEventListener("change", compute);
    const obs = new MutationObserver(compute);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => { mq.removeEventListener("change", compute); obs.disconnect(); };
  }, []);

  return isDark;
}
