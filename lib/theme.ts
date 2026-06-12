import { cookies } from "next/headers";

export const THEME_COOKIE = "theme";

export type Theme = "system" | "light" | "dark";

export function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

/** Server-side read of the theme cookie. Defaults to "system". */
export async function getTheme(): Promise<Theme> {
  const raw = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(raw) ? raw : "system";
}
