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
      // Raised after Phase 4C (PanelView deep-stack + WeekView DnD/click edges).
      // Measured 83.41 lines / 77.47 functions / 74.84 branches; set thresholds below measured.
      thresholds: {
        lines: 75,
        functions: 67,
        branches: 63,
      },
    },
  },
});
