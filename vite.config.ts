import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // NEXT_PUBLIC_SUPABASE_* are the public URL and key that the Vercel ↔ Supabase
  // integration adds to the Vercel project; exposing that prefix lets a deploy
  // work without copying them to VITE_* by hand. Server-only variables such as
  // SUPABASE_SERVICE_ROLE_KEY or POSTGRES_* do not match and stay private.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  plugins: [
    react(),
    tailwindcss(),
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
