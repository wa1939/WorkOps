import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
      id: '/',
      name: 'WorkOps',
      short_name: 'WorkOps',
      description: 'WorkOps — tasks, planning, shared KPIs and team updates in one self-hosted hub.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    lang: 'en',
    categories: ['business', 'productivity'],
    background_color: '#090f18',
    theme_color: '#090f18',
    icons: [
      { src: '/icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/app-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
