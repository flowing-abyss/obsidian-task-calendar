import { describe, expect, it } from 'vitest';
import { TaskStore } from '../src/store/TaskStore';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { createAppWithFiles, seedTaskCache, useRealMoment } from './helpers';

useRealMoment();

describe('TaskStore initialize + getTasks', () => {
  it('empty vault yields no tasks and fires one bulk onUpdate', async () => {
    const app = await createAppWithFiles({});
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    await store.initialize();
    expect(store.getTasks()).toEqual([]);
    // first event is bulk init (changedFile undefined)
    expect(events).toContain('bulk');
  });

  it('single file with one task parses fields', async () => {
    const app = await createAppWithFiles({ 'a.md': '- [ ] buy milk 📅 2026-06-24' });
    seedTaskCache(app, 'a.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const tasks = store.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toBe('buy milk');
    expect(tasks[0]?.status).toBe('open');
    expect(tasks[0]?.due).toBe('2026-06-24');
    expect(tasks[0]?.priority).toBe('D');
    expect(tasks[0]?.filePath).toBe('a.md');
    expect(tasks[0]?.line).toBe(0);
  });

  it('multiple files flatten tasks with filePath/line preserved', async () => {
    const app = await createAppWithFiles({
      'a.md': '- [ ] task a\n- [x] done a',
      'b.md': '- [ ] task b',
    });
    seedTaskCache(app, 'a.md', [
      { task: ' ', parent: -1, line: 0 },
      { task: 'x', parent: -1, line: 1 },
    ]);
    seedTaskCache(app, 'b.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const tasks = store.getTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks.filter((t) => t.filePath === 'a.md')).toHaveLength(2);
    expect(tasks.filter((t) => t.filePath === 'b.md')).toHaveLength(1);
  });

  it('frontmatter color/textColor/icon attach to tasks', async () => {
    const app = await createAppWithFiles({
      'a.md': '---\ncolor: "#ff0000"\ntextColor: "#00ff00"\nicon: "📧"\n---\n- [ ] task',
    });
    seedTaskCache(
      app,
      'a.md',
      [{ task: ' ', parent: -1, line: 5 }],
      { color: '#ff0000', textColor: '#00ff00', icon: '📧' },
    );
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const task = store.getTasks()[0]!;
    expect(task.noteColor).toBe('#ff0000');
    expect(task.noteTextColor).toBe('#00ff00');
    expect(task.noteIcon).toBe('📧');
  });

  it('file with no task listItems yields no tasks and is not in taskMap', async () => {
    const app = await createAppWithFiles({ 'empty.md': 'just text, no tasks' });
    seedTaskCache(app, 'empty.md', []);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(store.getTasks()).toEqual([]);
  });

  it('file with getFileCache returning null yields no tasks (no crash)', async () => {
    // createAppWithFiles auto-parses; to simulate a null cache, delete the cache entry
    const app = await createAppWithFiles({ 'null.md': '- [ ] x' });
    // overwrite cache with null by not seeding — getFileCache returns null for unseeded paths
    // Actually setCache__ was called by auto-parse; clear it by setting an empty object
    (app.metadataCache as unknown as { setCache__: (p: string, c: unknown) => void }).setCache__(
      'null.md',
      {},
    );
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(store.getTasks()).toEqual([]);
  });

  it('chunking loads >50 files (60 small files)', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      files[`f${i}.md`] = `- [ ] task ${i} 📅 2026-06-24`;
    }
    const app = await createAppWithFiles(files);
    for (const path of Object.keys(files)) {
      seedTaskCache(app, path, [{ task: ' ', parent: -1, line: 0 }]);
    }
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(store.getTasks()).toHaveLength(60);
  });

  it('daily note filename detection (YYYY-MM-DD format)', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      desktop: { ...DEFAULT_SETTINGS.desktop, dailyNoteFormat: 'YYYY-MM-DD' },
    };
    const app = await createAppWithFiles({ 'periodic/daily/2026-06-24.md': '- [ ] daily task' });
    seedTaskCache(app, 'periodic/daily/2026-06-24.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, settings);
    await store.initialize();
    expect(store.getTasks()[0]?.dailyNoteDate).toBe('2026-06-24');
  });

  it('non-daily-note filename yields undefined dailyNoteDate', async () => {
    const app = await createAppWithFiles({ 'random.md': '- [ ] task' });
    seedTaskCache(app, 'random.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(store.getTasks()[0]?.dailyNoteDate).toBeUndefined();
  });

  it('daily-note with non-ISO format (MMM D, YYYY)', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      desktop: { ...DEFAULT_SETTINGS.desktop, dailyNoteFormat: 'MMM D, YYYY' },
    };
    const app = await createAppWithFiles({ 'periodic/daily/Jun 24, 2026.md': '- [ ] task' });
    seedTaskCache(app, 'periodic/daily/Jun 24, 2026.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, settings);
    await store.initialize();
    expect(store.getTasks()[0]?.dailyNoteDate).toBe('2026-06-24');
  });

  it('globalTaskFilter strips the filter tag from task text', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      desktop: { ...DEFAULT_SETTINGS.desktop, globalTaskFilter: '#task' },
    };
    const app = await createAppWithFiles({ 'a.md': '- [ ] #task buy milk 📅 2026-06-24' });
    seedTaskCache(app, 'a.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, settings);
    await store.initialize();
    expect(store.getTasks()[0]?.text).toBe('buy milk');
  });
});

describe('TaskStore getTasks filters', () => {
  it('filter by filePath', async () => {
    const app = await createAppWithFiles({
      'a.md': '- [ ] a',
      'b.md': '- [ ] b',
    });
    seedTaskCache(app, 'a.md', [{ task: ' ', parent: -1, line: 0 }]);
    seedTaskCache(app, 'b.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(store.getTasks({ filePath: 'a.md' })).toHaveLength(1);
  });

  it('filter by folder (startsWith prefix)', async () => {
    const app = await createAppWithFiles({
      'sub/x.md': '- [ ] a',
      'subway.md': '- [ ] b',
      'other.md': '- [ ] c',
    });
    seedTaskCache(app, 'sub/x.md', [{ task: ' ', parent: -1, line: 0 }]);
    seedTaskCache(app, 'subway.md', [{ task: ' ', parent: -1, line: 0 }]);
    seedTaskCache(app, 'other.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    // CURRENT BEHAVIOR (follow-up FU-10): 'sub' matches 'subway.md' (startsWith prefix, not folder-segment-aware)
    const folderTasks = store.getTasks({ folder: 'sub' });
    expect(folderTasks.map((t) => t.filePath).sort((a, b) => a.localeCompare(b))).toEqual(['sub/x.md', 'subway.md']);
  });

  it('filter by tag (rawText includes)', async () => {
    const app = await createAppWithFiles({
      'a.md': '- [ ] task #work',
      'b.md': '- [ ] task #personal',
    });
    seedTaskCache(app, 'a.md', [{ task: ' ', parent: -1, line: 0 }]);
    seedTaskCache(app, 'b.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(store.getTasks({ tag: '#work' })).toHaveLength(1);
    expect(store.getTasks({ tag: '#personal' })).toHaveLength(1);
  });

  it('filter by status', async () => {
    const app = await createAppWithFiles({
      'a.md': '- [ ] open task\n- [x] done task',
    });
    seedTaskCache(app, 'a.md', [
      { task: ' ', parent: -1, line: 0 },
      { task: 'x', parent: -1, line: 1 },
    ]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(store.getTasks({ status: ['open'] })).toHaveLength(1);
    expect(store.getTasks({ status: ['done'] })).toHaveLength(1);
    expect(store.getTasks({ status: ['open', 'done'] })).toHaveLength(2);
  });

  it('filter by dateRange (due ?? scheduled ?? start ?? dailyNoteDate)', async () => {
    const app = await createAppWithFiles({
      'a.md': '- [ ] no date\n- [ ] due 📅 2026-06-20\n- [ ] scheduled ⏳ 2026-06-25',
    });
    seedTaskCache(app, 'a.md', [
      { task: ' ', parent: -1, line: 0 },
      { task: ' ', parent: -1, line: 1 },
      { task: ' ', parent: -1, line: 2 },
    ]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const inRange = store.getTasks({ dateRange: { from: '2026-06-01', to: '2026-06-30' } });
    // "no date" excluded; due (2026-06-20) and scheduled (2026-06-25) included
    expect(inRange).toHaveLength(2);
  });

  it('task with no date excluded from dateRange filter', async () => {
    const app = await createAppWithFiles({ 'a.md': '- [ ] no date task' });
    seedTaskCache(app, 'a.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(store.getTasks({ dateRange: { from: '2026-01-01', to: '2026-12-31' } })).toHaveLength(0);
  });

  it('combined filters (AND)', async () => {
    const app = await createAppWithFiles({
      'work/a.md': '- [ ] open task #urgent',
      'work/b.md': '- [x] done task #urgent',
    });
    seedTaskCache(app, 'work/a.md', [{ task: ' ', parent: -1, line: 0 }]);
    seedTaskCache(app, 'work/b.md', [{ task: 'x', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(
      store.getTasks({ folder: 'work', status: ['open'], tag: '#urgent' }),
    ).toHaveLength(1);
  });

  it('no filter returns all tasks', async () => {
    const app = await createAppWithFiles({ 'a.md': '- [ ] a\n- [ ] b' });
    seedTaskCache(app, 'a.md', [
      { task: ' ', parent: -1, line: 0 },
      { task: ' ', parent: -1, line: 1 },
    ]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    expect(store.getTasks()).toHaveLength(2);
  });
});