import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'tests/e2e/**', 'tests/api/**', '.next/**'],
    setupFiles: ['./vitest.setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**', 'components/**', 'hooks/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', 'lib/mock-data/**'],
    },
  },
});
