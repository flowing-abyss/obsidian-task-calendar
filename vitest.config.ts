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
      // Raised after Phase 2 store contract tests (events + destroy); ~2 pts below measured
      // (21.73 lines / 14.79 functions / 25.34 branches) to avoid flake. Bump as Phases 3-4
      // cover ui/views/panels/settings.
      thresholds: {
        lines: 19,
        functions: 12,
        branches: 23,
      },
    },
  },
});
