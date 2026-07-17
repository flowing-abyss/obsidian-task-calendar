import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/perf/**'],
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
      // Repository baseline after Task 12A: 83.55 lines / 74.29 functions / 75.68 branches.
      // Keep the historical global floors while pure task layers carry stricter contracts.
      thresholds: {
        lines: 78,
        functions: 70,
        branches: 66,
        'src/tasks/domain/**': {
          statements: 93,
          branches: 90,
          functions: 100,
          lines: 96,
        },
        'src/tasks/application/**': {
          statements: 96,
          branches: 94,
          functions: 100,
          lines: 98,
        },
        'src/tasks/infrastructure/markdown/**': {
          branches: 90,
          functions: 95,
          lines: 95,
        },
        'src/tasks/infrastructure/markdown/TaskMarkdownCodec.ts': {
          statements: 95,
          branches: 89,
          functions: 99,
          lines: 98,
        },
        'src/tasks/infrastructure/markdown/TaskBlockEditor.ts': {
          statements: 93,
          branches: 86,
          functions: 100,
          lines: 97,
        },
        'src/tasks/infrastructure/obsidian/ObsidianTaskRepository.ts': {
          branches: 85,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
