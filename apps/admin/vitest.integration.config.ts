import { defineConfig, loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load environment variables from .env file
  // This ensures integration tests can access environment variables from .env
  const env = loadEnv(mode, process.cwd(), '');
  
  // Set environment variables in process.env
  // This is needed because Vitest doesn't automatically load .env files like Next.js does
  Object.keys(env).forEach((key) => {
    if (!process.env[key]) {
      process.env[key] = env[key];
    }
  });

  return {
    test: {
      globals: true,
      environment: 'node',
      setupFiles: ['./vitest.integration.setup.ts'],
      include: ['src/**/*.integration.test.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
      exclude: ['node_modules', 'dist', '.next', '**/*.config.*'],
      testTimeout: 30000, // 30 seconds for integration tests (longer than unit tests)
      hookTimeout: 30000,
      // Test result reporters
      // 'default' - outputs to console (stdout/stderr)
      // 'json' - outputs JSON report to file
      // 'junit' - outputs JUnit XML report (useful for CI/CD)
      // 'html' - outputs HTML report (useful for viewing in browser)
      reporters: ['default', 'json', 'junit'],
      // Output file locations for test reports
      outputFile: {
        // JSON report: Machine-readable format for CI/CD
        json: './test-results/integration-results.json',
        // JUnit XML report: Standard format for CI/CD tools (Jenkins, GitHub Actions, etc.)
        junit: './test-results/integration-results.xml',
      },
      // Only run integration tests if INTEGRATION_TESTS=true
      // This allows skipping integration tests in CI if services aren't available
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});

