import type { Metadata } from 'next';
import './globals.css';

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
