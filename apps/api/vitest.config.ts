import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    // Password hashing and a real database make some tests slower than pure unit tests.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
