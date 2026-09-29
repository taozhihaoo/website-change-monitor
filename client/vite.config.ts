import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API calls to the Fastify backend so `npm run dev` (server)
// and `npm run dev:web` (client) can run side by side.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:3000',
      '/scheduler': 'http://localhost:3000',
      '/stats': 'http://localhost:3000',
      '/monitors': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
