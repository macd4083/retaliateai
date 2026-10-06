import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['logo.png'],
      manifest: {
        name: 'Retaliate AI',
        short_name: 'Retaliate AI',
        description: 'Review commitments and habits, plan measured actions, and track follow-through.',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/app',
        scope: '/',
        icons: [
          { src: '/android-chrome2-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/android-chrome2-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        navigateFallbackDenylist: [/^\/api\//],
        importScripts: ['/push-sw.js'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    exclude: ['web-push', 'resend'],
  },
  build: {
    rollupOptions: {
      external: ['web-push', 'resend'],
    },
  },
  test: {
    environment: 'jsdom',
  },
});
