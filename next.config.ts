import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === 'development';
const envAllowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultAllowedDevOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedDevOrigins = isDev
  ? Array.from(new Set([...defaultAllowedDevOrigins, ...envAllowedDevOrigins]))
  : [];
const maxUploadBodySize = process.env.MAX_UPLOAD_BODY_SIZE ?? '200mb';

const nextConfig: NextConfig = {
  allowedDevOrigins,
  devIndicators: false,
  serverExternalPackages: ['pdfkit', 'svg-to-pdfkit', 'exceljs'],
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
  async headers() {
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.public.blob.vercel-storage.com; connect-src 'self' https://vercel.com https://*.public.blob.vercel-storage.com https://*.blob.vercel-storage.com`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
