import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The repository-root `.env` belongs to the API and contains NODE_ENV. If Vite
 * loaded it, `vite build` would silently produce a *development* build of
 * React. So the web app keeps its own env files in apps/web (only VITE_*
 * variables, e.g. VITE_API_BASE_URL), and we read just PORT from the root
 * file for the dev proxy.
 */
function apiPort(): string {
  const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
  const parsed = existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')) : {};
  return process.env.PORT ?? parsed.PORT ?? '4000';
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // In development the browser talks only to Vite (localhost:5173), which
    // forwards /api to Express. Same origin = simple, secure cookies.
    proxy: {
      '/api': { target: `http://localhost:${apiPort()}`, changeOrigin: false },
    },
  },
});
