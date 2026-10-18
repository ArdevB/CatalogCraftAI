import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Read the shared root `.env` so the dev proxy targets the same PORT as the
  // API. Only variables prefixed with VITE_ are ever exposed to browser code.
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = env.PORT || '4000';

  return {
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      // In development the browser talks only to Vite (localhost:5173), which
      // forwards /api to Express. Same origin = simple, secure cookies later.
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false },
      },
    },
  };
});
