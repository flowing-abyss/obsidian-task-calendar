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
      // Raised after Phase 3 Task 10 (PanelView smoke tests — final Phase 3 task).
      // Measured 59.55 lines / 52.24 functions / 46.51 branches; set Phase 3 target below measured.
      thresholds: {
        lines: 38,
        functions: 42,
        branches: 28,
      },
    },
  },
});
