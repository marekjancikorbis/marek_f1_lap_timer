import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Purple Sector',
        short_name: 'Purple Sector',
        description: 'Lap timing with a live sector delta, for track days and rally events.',
        theme_color: '#0C0E12',
        background_color: '#0C0E12',
        display: 'standalone',
        // The drive screen turns sideways for delta only; the rest of the app locks itself upright (lib/orientation).
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Firebase's own pages (Google sign-in handler and iframe) must reach Hosting, not the app shell.
        navigateFallbackDenylist: [/^\/__\//],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 2000 },
});
