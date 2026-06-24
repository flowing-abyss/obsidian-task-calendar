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
      // Raised from 0 after Phase 1 pure-layer tests; ~2 pts below measured (14.6/16.9/8.4)
      // to avoid flake. Bump as Phases 2-4 cover store/ui/panels/settings.
      thresholds: {
        lines: 13,
        functions: 7,
        branches: 15,
      },
    },
  },
});
