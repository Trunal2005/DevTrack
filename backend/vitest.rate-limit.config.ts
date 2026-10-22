import { defineConfig } from 'vitest/config';

// HTTP middleware contracts use isolated adapters, never a database or live credentials.
export default defineConfig({
  test: {
    include: ['src/__tests__/middleware/resume-rate-limit.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
