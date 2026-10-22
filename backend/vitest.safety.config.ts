import { defineConfig } from 'vitest/config';

// These guard tests must run without the database-backed unit setup.
export default defineConfig({
  test: { include: ['tests/integration-database.test.ts'] },
});
