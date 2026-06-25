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
      // Raised after Phase 4A (RailPanel, LeftPanel, SettingsTab deep, registerCodeBlock deep, main.ts).
      // Measured 66.09 lines / 62.54 functions / 53.87 branches; set thresholds below measured.
      thresholds: {
        lines: 55,
        functions: 50,
        branches: 42,
      },
    },
  },
});
