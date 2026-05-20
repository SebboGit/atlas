import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Single 'node' environment for now — all current tests are Node-side
// (storage, auth, types). When we add React component tests, split this
// into vitest projects so the component subset runs under happy-dom.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'tests/e2e/**', '.next/**'],
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
