import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  envDir: '../..',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'illustrations/heritage-bus.svg'],
      manifest: {
        name: 'Lal Bus Tracker · লাল বাস ট্র্যাকার',
        short_name: 'Lal Bus',
        description: 'Dhaka University community bus tracking. Unofficial student project.',
        theme_color: '#A80F24',
        background_color: '#FFF9F7',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000' },
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true },
    },
  },
  build: { rollupOptions: { output: { manualChunks: { map: ['leaflet', 'react-leaflet'] } } } },
});
