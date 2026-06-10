import type { Metadata } from 'next';
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
