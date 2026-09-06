import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Durable state is a real SQLite file per test; keep suites isolated.
    pool: 'forks',
    testTimeout: 30_000,
    // Builds the CLI into a directory owned by this run, so the suite never depends on, and
    // never reuses, whatever happens to be sitting in dist/.
    globalSetup: ['tests/build-cli.ts'],
  },
});
