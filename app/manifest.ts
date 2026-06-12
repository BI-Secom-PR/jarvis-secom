import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Jarvis — SECOM',
    short_name: 'Jarvis',
    description: 'Assistente de dados da SECOM',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#03030a',
    theme_color: '#03030a',
    icons: [
      {
        src: '/icon',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
