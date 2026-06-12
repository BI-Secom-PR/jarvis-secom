import type { Metadata, Viewport } from 'next';
import { getTheme } from '@/lib/theme';
import './globals.css';

// Every page must be rendered per-request so Next can inject the CSP nonce
// generated in proxy.ts — a prerendered page would ship inline scripts
// without a nonce and the browser would block them.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Jarvis — SECOM',
  description: 'Assistente de dados da SECOM',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Jarvis',
  },
};

const THEME_COLORS = { light: '#f2f2f7', dark: '#03030a' };

export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    interactiveWidget: 'resizes-content',
    themeColor:
      theme === 'system'
        ? [
            { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
            { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
          ]
        : THEME_COLORS[theme],
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // "system" carries no class: light-dark() in globals.css follows the OS.
  // An explicit cookie pins color-scheme via the .light/.dark class — set
  // server-side so the first paint is already correct (no FOUC, no inline JS).
  const theme = await getTheme();
  return (
    <html
      lang="pt-BR"
      className={theme === 'system' ? undefined : theme}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
