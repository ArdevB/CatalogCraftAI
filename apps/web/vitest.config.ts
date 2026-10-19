import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    // Whole pages render in these tests (sidebar included); give slower machines room.
    testTimeout: 15_000,
    // Each test renders the full app in jsdom; too many at once starves slower machines.
    maxWorkers: 2,
  },
});
