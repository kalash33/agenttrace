import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: process.env['AGENTTRACE_INTEGRATION'] === 'true'
      ? ['tests/**/*.test.ts']
      : ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    globals: false,
    reporters: ['verbose'],
    testTimeout: 90_000,
    hookTimeout: 30_000,
    isolate: true,
    environment: 'node',
  },
});
