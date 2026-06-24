import { Notice } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { TaskStore } from '../src/store/TaskStore';
import { createAppWithFiles, seedTaskCache, useRealMoment } from './helpers';

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

describe('TaskStore error paths (Notice spy via vi.mock)', () => {
  beforeEach(() => {
    (Notice as unknown as { mock: { calls: unknown[][] } }).mock.calls = [];
  });

  it('toggleTask file not found shows Notice and does not write', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const task = store.getTasks()[0]!;
    await store.toggleTask({ ...task, filePath: 'nonexistent.md' });
    expect(noticeCalls().length).toBeGreaterThan(0);
    expect(noticeCalls()[0]?.[0]).toContain('File not found');
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe('- [ ] task');
  });

  it('toggleTask vault.process throwing shows Notice (no crash)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    (app.vault as unknown as { process: () => Promise<void> }).process = () =>
      Promise.reject(new Error('write failed'));
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(store.getTasks()[0]!);
    expect(noticeCalls().length).toBeGreaterThan(0);
    expect(String(noticeCalls()[0]?.[0])).toContain('Failed to update');
  });

  it('addTask polling exhausts shows Notice (fake timers)', async () => {
    const settings = { ...DEFAULT_SETTINGS, addToToday: true };
    const app = await createAppWithFiles({});
    (app as unknown as Record<string, unknown>).plugins = {
      'periodic-notes': { settings: { daily: { folder: 'periodic/daily', format: 'YYYY-MM-DD' } } },
    };
    (app as unknown as Record<string, unknown>).commands = {
      executeCommandById: () => {},
    };
    const store = new TaskStore(app, settings);
    vi.useFakeTimers({ now: new Date('2026-06-24T10:00:00Z').getTime() });
    const addPromise = store.addTask('2026-06-24', 'never resolves');
    for (let i = 0; i < 11; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }
    await addPromise;
    vi.useRealTimers();
    expect(noticeCalls().length).toBeGreaterThan(0);
    expect(
      String(noticeCalls().find((c) => String(c[0]).includes('No target file'))?.[0]),
    ).toContain('No target file');
  });

  it('addTask no config shows Notice', async () => {
    const settings = { ...DEFAULT_SETTINGS, addToToday: false, customFilePath: '' };
    const app = await createAppWithFiles({});
    const store = new TaskStore(app, settings);
    await store.addTask('2026-06-24', 'orphan task');
    expect(noticeCalls().length).toBeGreaterThan(0);
    expect(String(noticeCalls()[0]?.[0])).toContain('No target file');
  });
});
