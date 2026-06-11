import type { NextConfig } from "next";

type SizeLimit = number | `${number}${'k' | 'K' | 'm' | 'M' | 'g' | 'G' | 't' | 'T' | 'p' | 'P'}${'b' | 'B'}`;

const isDev = process.env.NODE_ENV === 'development';
const envAllowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultAllowedDevOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedDevOrigins = isDev
  ? Array.from(new Set([...defaultAllowedDevOrigins, ...envAllowedDevOrigins]))
  : [];
const maxUploadBodySize: SizeLimit = (process.env.MAX_UPLOAD_BODY_SIZE ?? '200mb') as SizeLimit;

const nextConfig: NextConfig = {
  allowedDevOrigins,
  devIndicators: false,
  serverExternalPackages: ['exceljs'],
  experimental: {
    serverActions: {
      bodySizeLimit: maxUploadBodySize,
    },
    proxyClientMaxBodySize: maxUploadBodySize,
  },
  async redirects() {
    return [
      {
        source: '/apple-touch-icon.png',
        destination: '/apple-icon.png',
        permanent: true,
      },
      {
        source: '/apple-touch-icon-precomposed.png',
        destination: '/apple-icon.png',
        permanent: true,
      },
    ];
  },
  // Content-Security-Policy is set per-request in proxy.ts (nonce-based).
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
          ...(isDev
            ? []
            : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]),
        ],
      },
    ];
  },
};

export default nextConfig;
