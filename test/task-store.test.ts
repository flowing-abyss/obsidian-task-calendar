import { TFile, type CachedMetadata } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { TaskStore } from '../src/store/TaskStore';
import {
  captureChangedCallback,
  createAppWithFiles,
  flushMicrotasks,
  seedTaskCache,
  useRealMoment,
} from './helpers';

useRealMoment();

/** Narrow getAbstractFileByPath to TFile via instanceof (satisfies no-tfile-tfolder-cast). */
function mdFile(
  app: { vault: { getAbstractFileByPath(p: string): unknown } },
  path: string,
): TFile {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`${path} is not a TFile`);
  return f;
}

/** Cast a partial cache object to CachedMetadata (position omits col/offset). */
function cache(obj: unknown): CachedMetadata {
  return obj as CachedMetadata;
}

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
    seedTaskCache(app, 'a.md', [{ task: ' ', parent: -1, line: 5 }], {
      color: '#ff0000',
      textColor: '#00ff00',
      icon: '📧',
    });
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
    expect(folderTasks.map((t) => t.filePath).sort((a, b) => a.localeCompare(b))).toEqual([
      'sub/x.md',
      'subway.md',
    ]);
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
    expect(store.getTasks({ folder: 'work', status: ['open'], tag: '#urgent' })).toHaveLength(1);
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

describe('TaskStore toggleTask', () => {
  it('toggles open to done, appends ✅ today, strips old ✅', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task 📅 2026-06-24 ✅ 2026-01-01' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(store.getTasks()[0]!);
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toMatch(/^- \[x\] task 📅 2026-06-24 ✅ \d{4}-\d{2}-\d{2}$/);
    expect(content).not.toContain('2026-01-01');
  });

  it('toggles open (no ✅) to done, appends ✅ today', async () => {
    const today = window.moment().format('YYYY-MM-DD');
    const app = await createAppWithFiles({ 't.md': `- [ ] task 📅 ${today}` });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(store.getTasks()[0]!);
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe(`- [x] task 📅 ${today} ✅ ${today}`);
  });

  it('toggles done to open, strips ✅ date', async () => {
    const app = await createAppWithFiles({ 't.md': '- [x] task ✅ 2026-06-22' });
    seedTaskCache(app, 't.md', [{ task: 'x', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(store.getTasks()[0]!);
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe('- [ ] task');
  });

  it('toggles a [-] cancelled line to open (CURRENT BEHAVIOR, follow-up FU-11)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [-] cancelled task' });
    seedTaskCache(app, 't.md', [{ task: '-', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(store.getTasks()[0]!);
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe('- [ ] cancelled task');
  });

  it('out-of-bounds task.line is a no-op (CURRENT BEHAVIOR)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const task = store.getTasks()[0]!;
    await store.toggleTask({ ...task, line: 999 });
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe('- [ ] task');
  });
});

describe('TaskStore addTask', () => {
  it('customFilePath path appends to existing file', async () => {
    const settings = { ...DEFAULT_SETTINGS, addToToday: false, customFilePath: 'inbox.md' };
    const app = await createAppWithFiles({ 'inbox.md': '- [ ] existing' });
    const store = new TaskStore(app, settings);
    await store.addTask('2026-06-24', 'new task');
    const file = app.vault.getAbstractFileByPath('inbox.md');
    if (!(file instanceof TFile)) throw new Error('inbox.md not a TFile');
    const content = await app.vault.cachedRead(file);
    expect(content).toBe('- [ ] existing\n- [ ] #task/one-off new task 📅 2026-06-24');
  });

  it('customFilePath path creates file then appends (leading newline, CURRENT BEHAVIOR, follow-up FU-14)', async () => {
    const settings = { ...DEFAULT_SETTINGS, addToToday: false, customFilePath: 'inbox.md' };
    const app = await createAppWithFiles({});
    const store = new TaskStore(app, settings);
    await store.addTask('2026-06-24', 'first task');
    const file = app.vault.getAbstractFileByPath('inbox.md');
    if (!(file instanceof TFile)) throw new Error('inbox.md not a TFile');
    const content = await app.vault.cachedRead(file);
    expect(content).toBe('\n- [ ] #task/one-off first task 📅 2026-06-24');
  });

  it('empty taskPrefix yields no prefix in the task line', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      addToToday: false,
      customFilePath: 'inbox.md',
      taskPrefix: '',
    };
    const app = await createAppWithFiles({ 'inbox.md': '' });
    const store = new TaskStore(app, settings);
    await store.addTask('2026-06-24', 'no prefix');
    const file = app.vault.getAbstractFileByPath('inbox.md');
    if (!(file instanceof TFile)) throw new Error('inbox.md not a TFile');
    const content = await app.vault.cachedRead(file);
    expect(content).toContain('- [ ] no prefix 📅 2026-06-24');
  });

  it('addToToday with existing daily-note file appends', async () => {
    const today = window.moment().format('YYYY-MM-DD');
    const settings = {
      ...DEFAULT_SETTINGS,
      addToToday: true,
      manualDailyNotePath: `periodic/daily/YYYY-MM-DD`,
    };
    const app = await createAppWithFiles({ [`periodic/daily/${today}.md`]: '- [ ] existing' });
    (app as unknown as Record<string, unknown>).plugins = { getPlugin: () => null };
    (app as unknown as Record<string, unknown>).internalPlugins = { getPluginById: () => null };
    const store = new TaskStore(app, settings);
    await store.addTask(today, 'today task');
    const file = app.vault.getAbstractFileByPath(`periodic/daily/${today}.md`);
    if (!(file instanceof TFile)) throw new Error('daily note not a TFile');
    const content = await app.vault.cachedRead(file);
    expect(content).toContain(`- [ ] #task/one-off today task 📅 ${today}`);
  });
});

describe('TaskStore onUpdate + events', () => {
  it('onUpdate returns an unsubscribe that stops notifications', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] x' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    const off = store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    off();
    // trigger a rename to see if events fire
    const file = mdFile(app, 't.md');
    await app.vault.rename(file, 't2.md');
    await flushMicrotasks(20);
    expect(events).toHaveLength(0);
  });

  it('metadataCache changed (via captureChangedCallback) re-parses + updates + notifies', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] old' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const fireChanged = captureChangedCallback(app);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = mdFile(app, 't.md');
    fireChanged(
      file,
      '- [ ] new 📅 2026-06-25',
      cache({
        listItems: [{ task: ' ', parent: -1, position: { start: { line: 0 }, end: { line: 0 } } }],
        frontmatter: { color: '#abc' },
      }),
    );
    expect(events).toContain('t.md');
    const tasks = store.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.due).toBe('2026-06-25');
    expect(tasks[0]?.noteColor).toBe('#abc');
  });

  it('changed with frontmatter updates frontmatterMap', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] x' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const fireChanged = captureChangedCallback(app);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const file = mdFile(app, 't.md');
    fireChanged(
      file,
      '- [ ] x',
      cache({
        listItems: [{ task: ' ', parent: -1, position: { start: { line: 0 }, end: { line: 0 } } }],
        frontmatter: { color: '#def', icon: '⭐' },
      }),
    );
    const task = store.getTasks()[0]!;
    expect(task.noteColor).toBe('#def');
    expect(task.noteIcon).toBe('⭐');
  });

  it('vault rename moves tasks + frontmatter and notifies', async () => {
    const app = await createAppWithFiles({ 'old.md': '- [ ] task' });
    seedTaskCache(app, 'old.md', [{ task: ' ', parent: -1, line: 0 }], { color: '#aaa' });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = mdFile(app, 'old.md');
    await app.vault.rename(file, 'new.md');
    await flushMicrotasks(20);
    expect(events).toContain('new.md');
    const tasks = store.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.filePath).toBe('new.md');
    expect(tasks[0]?.noteColor).toBe('#aaa');
  });

  it('rename of a .md file with no tasks still notifies (CURRENT BEHAVIOR, follow-up FU-13)', async () => {
    const app = await createAppWithFiles({ 'empty.md': 'no tasks here' });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = mdFile(app, 'empty.md');
    await app.vault.rename(file, 'empty2.md');
    await flushMicrotasks(20);
    expect(events).toContain('empty2.md');
  });

  it('vault delete removes tasks + notifies', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = mdFile(app, 't.md');
    await app.vault.delete(file);
    await flushMicrotasks(20);
    expect(events).toContain('t.md');
    expect(store.getTasks()).toHaveLength(0);
  });

  it('delete of a file with no tasks does not notify', async () => {
    const app = await createAppWithFiles({ 'empty.md': 'no tasks' });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = mdFile(app, 'empty.md');
    await app.vault.delete(file);
    await flushMicrotasks(20);
    expect(events).toHaveLength(0);
  });
});

describe('TaskStore destroy', () => {
  it('destroy detaches events (no further onUpdate)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] x' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    // Capture to ensure the changed handler registers; destroy must detach it so the mock's
    // own event dispatch no longer invokes it. (fireChanged bypasses offref via its closure,
    // so we use the mock's trigger() which respects offref after destroy.)
    captureChangedCallback(app);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    store.destroy();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = mdFile(app, 't.md');
    (
      app.metadataCache as unknown as {
        trigger(name: string, ...data: unknown[]): void;
      }
    ).trigger(
      'changed',
      file,
      '- [ ] changed',
      cache({
        listItems: [{ task: ' ', parent: -1, position: { start: { line: 0 }, end: { line: 0 } } }],
        frontmatter: { color: '#def' },
      }),
    );
    // destroy detaches the metadataCache changed handler (offref), so the mock's trigger no
    // longer calls it; onUpdate was re-registered after destroy (listeners cleared), but the
    // changed handler is detached so it won't call notify. events should be empty.
    expect(events).toHaveLength(0);
  });

  it('destroy is idempotent (calling twice does not throw)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] x' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    store.destroy();
    expect(() => store.destroy()).not.toThrow();
  });
});
