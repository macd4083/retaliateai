import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'Retaliate AI',
        short_name: 'Retaliate AI',
        description: 'The accountability system that closes the loop.',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/reflection',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
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
});
