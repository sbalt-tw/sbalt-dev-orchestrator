import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Durable state is a real SQLite file per test; keep suites isolated.
    pool: 'forks',
    testTimeout: 20_000,
  },
});
