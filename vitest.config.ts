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
      // Raised after Phase 5 (contract layer coverage: parser/store/resolver deep tests).
      // Measured 84.28 lines / 77.65 functions / 76.44 branches; set thresholds below measured.
      thresholds: {
        lines: 78,
        functions: 70,
        branches: 66,
      },
    },
  },
});
