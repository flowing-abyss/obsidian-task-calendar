import { Notice } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { TaskStore } from '../src/store/TaskStore';
import type { TaskApplicationApi, TaskCommandResult } from '../src/tasks';
import { createAppWithFiles, readStoreTasks, seedTaskCache, useRealMoment } from './helpers';

// File-level mock: override Notice with a vi.fn so TaskStore's `new Notice(msg)` is captured.
// Everything else from obsidian stays real (spread actual). Verified empirically.
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
  return { ...actual, Notice: vi.fn() };
});

useRealMoment();

// Helper to read the mocked Notice's call history
function noticeCalls(): unknown[][] {
  return (Notice as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

function taskApi(result: TaskCommandResult): TaskApplicationApi {
  return {
    queries: {
      list: () => [],
      forCalendarDates: () => [],
      resolve: (ref) => ({ type: 'not-found', ref }),
      subscribe: () => () => {},
    },
    execute: vi.fn().mockResolvedValue(result),
  };
}

describe('TaskStore error paths (Notice spy via vi.mock)', () => {
  beforeEach(() => {
    (Notice as unknown as { mock: { calls: unknown[][] } }).mock.calls = [];
  });

  it('toggleTask file not found shows Notice and does not write', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(
      app,
      DEFAULT_SETTINGS,
      undefined,
      taskApi({
        type: 'not-found',
        target: { type: 'task', ref: { filePath: 'nonexistent.md', line: 0, revision: 'missing' } },
      }),
    );
    await store.initialize();
    const task = readStoreTasks(store)[0]!;
    await store.toggleTask({ ...task, filePath: 'nonexistent.md' });
    expect(noticeCalls().length).toBeGreaterThan(0);
    expect(noticeCalls()[0]?.[0]).toContain('no longer exists');
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe('- [ ] task');
  });

  it('toggleTask vault.process throwing shows Notice (no crash)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(
      app,
      DEFAULT_SETTINGS,
      undefined,
      taskApi({
        type: 'io-error',
        cause: 'process-error',
        path: 't.md',
        contentState: 'unknown',
      }),
    );
    await store.initialize();
    await store.toggleTask(readStoreTasks(store)[0]!);
    expect(noticeCalls().length).toBeGreaterThan(0);
    expect(String(noticeCalls()[0]?.[0])).toContain('Failed to update');
  });
});
