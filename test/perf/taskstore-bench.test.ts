/**
 * Reproducible performance harness for TaskStore / vault-wide indexing.
 *
 * Excluded from the normal test suite via vitest.config.ts.
 * Run with:
 *   npm run bench
 *   npx vitest run test/perf/taskstore-bench.test.ts
 *
 * Prints metrics to the test output in both human-readable and JSON form.
 */
// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { App as ObsidianApp } from 'obsidian';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings/defaults';
import { TaskStore } from '../../src/store/TaskStore';

beforeEach(() => {
  (window as unknown as { moment: unknown }).moment = moment;
});

// ---------------------------------------------------------------------------
// Synthetic file builder
// ---------------------------------------------------------------------------

function buildFileContent(fileIndex: number, tasksPerFile: number): string {
  const lines: string[] = [`# File ${fileIndex}`];
  for (let t = 0; t < tasksPerFile; t++) {
    const i = fileIndex * tasksPerFile + t;
    const due = `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    lines.push(`- [ ] Task ${i} 📅 ${due} #tag${i % 5}`);
  }
  return lines.join('\n');
}

function buildFiles(fileCount: number, tasksPerFile: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < fileCount; i++) {
    files[`file-${i}.md`] = buildFileContent(i, tasksPerFile);
  }
  return files;
}

// ---------------------------------------------------------------------------
// App factory (mirrors createAppWithFiles in test/helpers.ts)
// ---------------------------------------------------------------------------

async function createApp(files: Record<string, string>): Promise<ObsidianApp> {
  const app = (
    ObsidianApp as unknown as {
      createConfigured__: (p: { files: Record<string, string> }) => ObsidianApp;
    }
  ).createConfigured__({ files });
  await Promise.all(app.vault.getMarkdownFiles().map((f) => app.vault.cachedRead(f)));
  await new Promise<void>((r) => window.setTimeout(r, 10));
  return app;
}

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

async function time<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - t0 };
}

async function avgMs(fn: () => Promise<void> | void, runs: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    total += performance.now() - t0;
  }
  return total / runs;
}

// ---------------------------------------------------------------------------
// Benchmark scenarios
// ---------------------------------------------------------------------------

const DENSITY = 10; // tasks per file
const RUNS = 3;

async function runScenario(
  fileCount: number,
  tasksPerFile: number,
): Promise<Record<string, number | string>> {
  const files = buildFiles(fileCount, tasksPerFile);
  const app = await createApp(files);

  // Initial indexing
  const { ms: initialMs } = await time(async () => {
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    store.destroy();
  });

  // Build reusable store for query benchmarks
  const store = new TaskStore(app, DEFAULT_SETTINGS);
  await store.initialize();
  const totalTasks = store.getTasks().length;

  // Query benchmarks (repeated for stable avg)
  const queryAllMs = await avgMs(() => {
    store.getTasks();
  }, RUNS * 10);
  const queryTagMs = await avgMs(() => {
    store.getTasks({ tag: '#tag1' });
  }, RUNS * 10);
  const queryDateMs = await avgMs(() => {
    store.getTasks({ dateRange: { from: '2026-01-01', to: '2026-12-31' } });
  }, RUNS * 10);
  const queryFileMs = await avgMs(() => {
    store.getTasks({ filePath: 'file-0.md' });
  }, RUNS * 10);

  store.destroy();

  return {
    fileCount,
    tasksPerFile,
    totalTasks,
    initialIndexMs: Math.round(initialMs),
    queryAllMs: Math.round(queryAllMs * 1000) / 1000,
    queryByTagMs: Math.round(queryTagMs * 1000) / 1000,
    queryByDateRangeMs: Math.round(queryDateMs * 1000) / 1000,
    queryByFileMs: Math.round(queryFileMs * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskStore performance benchmark', () => {
  for (const fileCount of [1000, 5000, 10000]) {
    it(`${fileCount} files × ${DENSITY} tasks/file`, async () => {
      const metrics = await runScenario(fileCount, DENSITY);

      console.log(`\n📊 ${fileCount} files × ${DENSITY} tasks/file`);
      console.log(`   Total tasks:         ${metrics['totalTasks']}`);
      console.log(`   Initial index:       ${metrics['initialIndexMs']} ms`);
      console.log(`   getTasks() all:      ${metrics['queryAllMs']} ms (avg)`);
      console.log(`   getTasks() by tag:   ${metrics['queryByTagMs']} ms (avg)`);
      console.log(`   getTasks() dateRange:${metrics['queryByDateRangeMs']} ms (avg)`);
      console.log(`   getTasks() filePath: ${metrics['queryByFileMs']} ms (avg)`);
      console.log(`   JSON: ${JSON.stringify(metrics)}`);

      // Loose sanity bounds — fail the test if indexing regresses catastrophically.
      // Adjust thresholds if hardware or vault size changes.
      const indexMs = metrics['initialIndexMs'] as number;
      if (fileCount === 1000) {
        // Expect initial indexing of 1k files to complete in < 10s
        expect(indexMs).toBeLessThan(10_000);
      } else if (fileCount === 5000) {
        expect(indexMs).toBeLessThan(30_000);
      } else {
        expect(indexMs).toBeLessThan(60_000);
      }
    }, 120_000); // 2-min timeout per scenario
  }

  it('high-density: 100 files × 100 tasks each (dense file scenario)', async () => {
    const metrics = await runScenario(100, 100);
    console.log(`\n📊 Dense: 100 files × 100 tasks`);
    console.log(`   Total tasks: ${metrics['totalTasks']}`);
    console.log(`   Initial index: ${metrics['initialIndexMs']} ms`);
    console.log(`   getTasks() all: ${metrics['queryAllMs']} ms`);
    console.log(`   JSON: ${JSON.stringify(metrics)}`);
    expect(metrics['initialIndexMs'] as number).toBeLessThan(5_000);
  }, 30_000);
});
