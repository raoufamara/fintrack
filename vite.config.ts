import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // NEXT_PUBLIC_SUPABASE_* are the public URL and key that the Vercel ↔ Supabase
  // integration adds to the Vercel project; exposing that prefix lets a deploy
  // work without copying them to VITE_* by hand. Server-only variables such as
  // SUPABASE_SERVICE_ROLE_KEY or POSTGRES_* do not match and stay private.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  plugins: [
    react(),
    tailwindcss(),
    // Installable app ("Add to Home Screen" on iPhone) that opens offline.
    // The service worker precaches only the app's own files; Supabase, the
    // exchange-rate API and place search are cross-origin and always go to
    // the network (rates and trips have their own IndexedDB caches).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['fintrack.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Fintrack',
        short_name: 'Fintrack',
        description: 'Budgets and shared trip expenses',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F8F9FA',
        theme_color: '#F8F9FA',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // The demo page is its own app; never answer it with the main shell.
        navigateFallbackDenylist: [/^\/trips-demo\.html/],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // Standalone Trips demo (in-memory data, no Supabase).
        tripsDemo: fileURLToPath(new URL('./trips-demo.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
