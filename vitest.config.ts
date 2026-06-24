import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['obsidian-test-mocks/vitest-setup'],
    passWithNoTests: true,
    environment: 'jsdom',
    alias: {
      obsidian: 'obsidian-test-mocks/obsidian',
    },
    server: {
      deps: {
        inline: ['@obsidian-typings', 'obsidian-dev-utils'],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/main.ts'],
      // Raised after Phase 3 Task 9 (CalendarRenderer TaskInputModal submit path).
      // Measured 44.07 lines / 40.16 functions / 37.16 branches; set ~2-4 pts below to avoid flake.
      thresholds: {
        lines: 36,
        functions: 38,
        branches: 26,
      },
    },
  },
});
