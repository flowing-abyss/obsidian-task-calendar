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
      // Raised after Phase 4B (CenterPanel + RightPanel deep coverage).
      // Measured 82.67 lines / 76.55 functions / 74.21 branches; set thresholds below measured.
      thresholds: {
        lines: 72,
        functions: 65,
        branches: 60,
      },
    },
  },
});
