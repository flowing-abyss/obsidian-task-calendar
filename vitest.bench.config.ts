import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/perf/**/*.test.ts'],
    setupFiles: ['obsidian-test-mocks/vitest-setup'],
    globals: true,
    environment: 'jsdom',
    alias: {
      obsidian: 'obsidian-test-mocks/obsidian',
    },
    server: {
      deps: {
        inline: ['@obsidian-typings', 'obsidian-dev-utils'],
      },
    },
  },
});
