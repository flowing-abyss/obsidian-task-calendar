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
import type { LocalDate } from '../../src/tasks';
import { readStoreTasks, taskQueriesOf } from '../helpers';

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
const QUERY_RUNS = RUNS * 10; // frozen at 30 invocations per query path
const CALENDAR_DATES = Array.from({ length: 42 }, (_, offset) => {
  const date = new Date(Date.UTC(2026, 4, 25 + offset));
  return date.toISOString().slice(0, 10);
});

interface ScenarioMetrics {
  fileCount: number;
  tasksPerFile: number;
  totalTasks: number;
  initialIndexMs: number;
  queryAllMs: number;
  queryByTagMs: number;
  queryByListDateMs: number;
  queryByCalendarDateMs: number;
  queryByFileMs: number;
}

interface PerformanceBudget {
  initialIndexMs: number;
  queryAllMs: number;
  queryByTagMs: number;
  queryByListDateMs: number;
  queryByCalendarDateMs: number;
  queryByFileMs: number;
}

interface Scenario {
  label: string;
  fileCount: number;
  tasksPerFile: number;
  budget: PerformanceBudget;
}

const SCENARIOS: Scenario[] = [
  {
    label: '1,000 files × 10 tasks/file',
    fileCount: 1_000,
    tasksPerFile: DENSITY,
    budget: {
      initialIndexMs: 2_000,
      queryAllMs: 25,
      queryByTagMs: 50,
      queryByListDateMs: 50,
      queryByCalendarDateMs: 50,
      queryByFileMs: 5,
    },
  },
  {
    label: '5,000 files × 10 tasks/file',
    fileCount: 5_000,
    tasksPerFile: DENSITY,
    budget: {
      initialIndexMs: 5_000,
      queryAllMs: 50,
      queryByTagMs: 100,
      queryByListDateMs: 100,
      queryByCalendarDateMs: 100,
      queryByFileMs: 5,
    },
  },
  {
    label: '10,000 files × 10 tasks/file',
    fileCount: 10_000,
    tasksPerFile: DENSITY,
    budget: {
      initialIndexMs: 10_000,
      queryAllMs: 100,
      queryByTagMs: 200,
      queryByListDateMs: 200,
      queryByCalendarDateMs: 200,
      queryByFileMs: 10,
    },
  },
  {
    label: 'dense: 100 files × 100 tasks/file',
    fileCount: 100,
    tasksPerFile: 100,
    budget: {
      initialIndexMs: 2_000,
      queryAllMs: 25,
      queryByTagMs: 50,
      queryByListDateMs: 50,
      queryByCalendarDateMs: 50,
      queryByFileMs: 5,
    },
  },
];

async function runScenario(fileCount: number, tasksPerFile: number): Promise<ScenarioMetrics> {
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
  const totalTasks = readStoreTasks(store).length;

  // Query benchmarks (repeated for stable avg)
  const queryAllMs = await avgMs(() => {
    readStoreTasks(store);
  }, QUERY_RUNS);
  const queryTagMs = await avgMs(() => {
    readStoreTasks(store, { tag: '#tag1' });
  }, QUERY_RUNS);
  const queryListDateMs = await avgMs(() => {
    readStoreTasks(store, { dateRange: { from: '2026-01-01', to: '2026-12-31' } });
  }, QUERY_RUNS);
  const queryCalendarDateMs = await avgMs(() => {
    taskQueriesOf(store).forCalendarDates(CALENDAR_DATES as LocalDate[]);
  }, QUERY_RUNS);
  const queryFileMs = await avgMs(() => {
    readStoreTasks(store, { filePath: 'file-0.md' });
  }, QUERY_RUNS);

  store.destroy();

  return {
    fileCount,
    tasksPerFile,
    totalTasks,
    initialIndexMs: initialMs,
    queryAllMs,
    queryByTagMs: queryTagMs,
    queryByListDateMs: queryListDateMs,
    queryByCalendarDateMs: queryCalendarDateMs,
    queryByFileMs: queryFileMs,
  };
}

function printMetrics(label: string, metrics: ScenarioMetrics): void {
  console.log(`\n📊 ${label}`);
  console.log(`   Total tasks:                ${metrics.totalTasks}`);
  console.log(`   Initial index:              ${metrics.initialIndexMs.toFixed(3)} ms`);
  console.log(`   query list all:             ${metrics.queryAllMs.toFixed(3)} ms (30 avg)`);
  console.log(`   query list by tag:          ${metrics.queryByTagMs.toFixed(3)} ms (30 avg)`);
  console.log(`   query list date range:      ${metrics.queryByListDateMs.toFixed(3)} ms (30 avg)`);
  console.log(
    `   calendar date union:        ${metrics.queryByCalendarDateMs.toFixed(3)} ms (30 avg)`,
  );
  console.log(`   query list filePath:        ${metrics.queryByFileMs.toFixed(3)} ms (30 avg)`);
  console.log(`   JSON: ${JSON.stringify(metrics)}`);
}

function expectWithinBudget(metrics: ScenarioMetrics, budget: PerformanceBudget): void {
  expect(metrics.initialIndexMs).toBeLessThan(budget.initialIndexMs);
  expect(metrics.queryAllMs).toBeLessThan(budget.queryAllMs);
  expect(metrics.queryByTagMs).toBeLessThan(budget.queryByTagMs);
  expect(metrics.queryByListDateMs).toBeLessThan(budget.queryByListDateMs);
  expect(metrics.queryByCalendarDateMs).toBeLessThan(budget.queryByCalendarDateMs);
  expect(metrics.queryByFileMs).toBeLessThan(budget.queryByFileMs);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskStore performance benchmark', () => {
  for (const scenario of SCENARIOS) {
    it(
      scenario.label,
      async () => {
        const metrics = await runScenario(scenario.fileCount, scenario.tasksPerFile);

        printMetrics(scenario.label, metrics);
        expectWithinBudget(metrics, scenario.budget);
      },
      120_000,
    );
  }
});
