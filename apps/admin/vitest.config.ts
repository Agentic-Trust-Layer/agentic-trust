import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [
      'node_modules',
      'dist',
      '.next',
      '**/*.config.*',
      '**/*.integration.test.{js,mjs,cjs,ts,mts,cts,jsx,tsx}', // Exclude integration tests from unit tests
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/**/*.d.ts',
        'src/**/*.config.*',
        'src/**/__tests__/**',
        'src/**/_lib/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'vitest.setup.ts',
        'vitest.config.ts',
      ],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

