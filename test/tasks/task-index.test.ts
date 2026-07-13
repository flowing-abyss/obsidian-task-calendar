import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TFile, type CachedMetadata, type TAbstractFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { TaskIndex } from '../../src/tasks/infrastructure/TaskIndex';
import {
  canonicalStatusCatalog,
  captureChangedCallback,
  createAppWithFiles,
  flushMicrotasks,
  seedTaskCache,
  useRealMoment,
} from '../helpers';

useRealMoment();

function taskCache(line = 0, frontmatter?: Record<string, unknown>): CachedMetadata {
  return {
    listItems: [
      {
        task: ' ',
        parent: -1,
        position: { start: { line }, end: { line } },
      },
    ],
    ...(frontmatter ? { frontmatter } : {}),
  } as CachedMetadata;
}

async function setup(files: Record<string, string>): Promise<{
  app: Awaited<ReturnType<typeof createAppWithFiles>>;
  index: TaskIndex;
  fireChanged: (file: TFile, data: string, cache: CachedMetadata) => void;
}> {
  const app = await createAppWithFiles(files);
  for (const path of Object.keys(files))
    seedTaskCache(app, path, [{ task: ' ', parent: -1, line: 0 }]);
  const fireChanged = captureChangedCallback(app);
  const index = new TaskIndex(app, {
    statusCatalog: canonicalStatusCatalog(),
    dailyNoteFormat: 'YYYY-MM-DD',
  });
  return { app, index, fireChanged };
}

function mdFile(app: Awaited<ReturnType<typeof createAppWithFiles>>, path: string): TFile {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`missing ${path}`);
  return file;
}

function deferred(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  return { promise, release };
}

function blockRead(
  app: Awaited<ReturnType<typeof createAppWithFiles>>,
  path: string,
  staleContent: string,
): { readonly started: Promise<void>; readonly release: () => void } {
  const originalRead = app.vault.cachedRead.bind(app.vault);
  const gate = deferred();
  let markStarted!: () => void;
  const started = new Promise<void>((resolvePromise) => {
    markStarted = resolvePromise;
  });
  let blocked = false;
  app.vault.cachedRead = async (file): Promise<string> => {
    const observedPath = file.path;
    if (observedPath !== path || blocked) return originalRead(file);
    blocked = true;
    markStarted();
    await gate.promise;
    return staleContent;
  };
  return { started, release: gate.release };
}

function captureCreateCallback(
  app: Awaited<ReturnType<typeof createAppWithFiles>>,
): (file: TAbstractFile) => void {
  let captured: ((file: TAbstractFile) => void) | undefined;
  const originalOn = app.vault.on.bind(app.vault) as (
    name: string,
    callback: (...args: unknown[]) => void,
  ) => unknown;
  app.vault.on = ((name: string, callback: (...args: unknown[]) => void) => {
    if (name === 'create') captured = callback as (file: TAbstractFile) => void;
    return originalOn(name, callback);
  }) as typeof app.vault.on;
  return (file: TAbstractFile): void => {
    if (!captured) throw new Error('captureCreateCallback: no create handler registered');
    captured(file);
  };
}

describe('TaskIndex lifecycle and events', () => {
  it('holds file lifecycle generations by weak identity', async () => {
    const { index } = await setup({ 'task.md': '- [ ] task' });
    expect((index as unknown as { fileLifecycles: unknown }).fileLifecycles).toBeInstanceOf(
      WeakMap,
    );
    index.destroy();
  });

  it('composes TaskMarkdownCodec directly instead of the legacy root parser', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../src/tasks/infrastructure/TaskIndex.ts'),
      'utf8',
    );
    expect(source).toContain('TaskMarkdownCodec');
    expect(source).not.toContain("from '../../parser/TaskParser'");
    expect(source).not.toMatch(/\bparseTask\s*\(/u);
  });

  it('initially scans markdown files and returns stable vault-path/line ordering', async () => {
    const { index } = await setup({
      'z.md': '- [ ] z',
      'a.md': '- [ ] first\n- [ ] second',
    });
    const app = (index as unknown as { app: Awaited<ReturnType<typeof createAppWithFiles>> }).app;
    seedTaskCache(app, 'a.md', [
      { task: ' ', parent: -1, line: 0 },
      { task: ' ', parent: -1, line: 1 },
    ]);
    const events: unknown[] = [];
    index.subscribe((event) => events.push(event));
    await index.initialize();
    expect(index.list().map((task) => `${task.source.filePath}:${task.source.line}`)).toEqual([
      'a.md:0',
      'a.md:1',
      'z.md:0',
    ]);
    expect(events).toEqual([{ type: 'initialized' }]);
    expect(Object.isFrozen(events[0])).toBe(true);
    index.destroy();
  });

  it('atomically replaces modified files, observes metadata-only changes, and batches refresh events', async () => {
    const { app, index, fireChanged } = await setup({ 'a.md': '- [ ] a', 'b.md': '- [ ] b' });
    await index.initialize();
    const events: Array<{ type: string; files?: readonly string[] }> = [];
    index.subscribe((event) => {
      if (event.type === 'changed') {
        expect(index.list({ filePath: event.files[0] })).toHaveLength(1);
      }
      events.push(event);
    });
    fireChanged(mdFile(app, 'b.md'), '- [ ] b2', taskCache(0, { color: '#bbb' }));
    fireChanged(mdFile(app, 'a.md'), '- [ ] a2', taskCache(0, { color: '#aaa' }));
    await flushMicrotasks();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'changed', files: ['a.md', 'b.md'] });
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0]?.files)).toBe(true);
    expect(index.list().map((task) => [task.title, task.presentation.noteColor])).toEqual([
      ['a2', '#aaa'],
      ['b2', '#bbb'],
    ]);
    index.destroy();
  });

  it('handles create, rename with oldPath, and delete after applying each change', async () => {
    const { app, index, fireChanged } = await setup({ 'old.md': '- [ ] old' });
    await index.initialize();
    const events: unknown[] = [];
    index.subscribe((event) => events.push(event));

    const created = await app.vault.create('created.md', '- [ ] created');
    fireChanged(created, '- [ ] created', taskCache());
    expect(index.list({ filePath: 'created.md' })).toHaveLength(1);
    await flushMicrotasks();
    expect(index.list({ filePath: 'created.md' })).toHaveLength(1);

    await app.vault.rename(mdFile(app, 'old.md'), 'new.md');
    await flushMicrotasks();
    expect(index.list({ filePath: 'old.md' })).toEqual([]);
    expect(index.list({ filePath: 'new.md' })).toHaveLength(1);

    await app.vault.delete(created);
    await flushMicrotasks();
    expect(index.list({ filePath: 'created.md' })).toEqual([]);
    expect(events).toContainEqual({ type: 'renamed', oldPath: 'old.md', newPath: 'new.md' });
    expect(events).toContainEqual({ type: 'deleted', path: 'created.md' });
    index.destroy();
  });

  it('unsubscribe and destroy dispose listeners and pending notifications', async () => {
    const { app, index, fireChanged } = await setup({ 'a.md': '- [ ] a' });
    await index.initialize();
    let calls = 0;
    const off = index.subscribe(() => calls++);
    off();
    fireChanged(mdFile(app, 'a.md'), '- [ ] changed', taskCache());
    await flushMicrotasks();
    expect(calls).toBe(0);

    index.destroy();
    index.destroy();
    app.metadataCache.trigger('changed', mdFile(app, 'a.md'), '- [ ] later', taskCache());
    await flushMicrotasks();
    expect(index.list()).toEqual([]);
  });

  it('destroy prevents an in-flight initial read from repopulating the index', async () => {
    const { app, index } = await setup({ 'a.md': '- [ ] a' });
    const cachedRead = app.vault.cachedRead.bind(app.vault);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.vault.cachedRead = async (file): Promise<string> => {
      await blocked;
      return cachedRead(file);
    };
    const events: unknown[] = [];
    index.subscribe((event) => events.push(event));
    const initializing = index.initialize();
    index.destroy();
    release();
    await initializing;
    expect(index.list()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('indexes a file created while the initial scan is blocked', async () => {
    const { app, index } = await setup({ 'blocked.md': '- [ ] initial' });
    const read = blockRead(app, 'blocked.md', '- [ ] initial');
    const events: unknown[] = [];
    index.subscribe((event) => events.push(event));

    const initializing = index.initialize();
    await read.started;
    await app.vault.create('created.md', '- [ ] created');
    read.release();
    await initializing;

    expect(index.list().map((task) => task.title)).toEqual(['initial', 'created']);
    expect(events).toEqual([{ type: 'initialized' }]);
    index.destroy();
  });

  it('fallback creation indexes nested tasks once under their root parent', async () => {
    const content = ['- [ ] parent', '  - [ ] child', '    - [ ] grandchild', '- [ ] sibling'].join(
      '\n',
    );
    const app = await createAppWithFiles({ 'created.md': content });
    app.metadataCache.getFileCache = (): null => null;
    const index = new TaskIndex(app, {
      statusCatalog: canonicalStatusCatalog(),
      dailyNoteFormat: 'YYYY-MM-DD',
    });
    const fireCreate = captureCreateCallback(app);
    await index.initialize();
    const file = mdFile(app, 'created.md');

    fireCreate(file);
    await flushMicrotasks();

    const tasks = index.list();
    expect(tasks.map((task) => task.title)).toEqual(['parent', 'sibling']);
    expect(tasks[0]?.subtasks.map((task) => task.title)).toEqual(['child']);
    expect(tasks[0]?.subtasks[0]?.subtasks.map((task) => task.title)).toEqual(['grandchild']);
    index.destroy();
  });

  it('fallback creation leaves an unclosed quoted fence before indexing plain tasks', async () => {
    const content = [
      '> [!example] Fenced tasks',
      '> ```md',
      '> - [ ] hidden quoted example',
      '- [ ] visible plain',
    ].join('\n');
    const app = await createAppWithFiles({ 'created.md': content });
    app.metadataCache.getFileCache = (): null => null;
    const index = new TaskIndex(app, {
      statusCatalog: canonicalStatusCatalog(),
      dailyNoteFormat: 'YYYY-MM-DD',
    });
    const fireCreate = captureCreateCallback(app);
    await index.initialize();

    fireCreate(mdFile(app, 'created.md'));
    await flushMicrotasks();

    expect(index.list().map((task) => task.title)).toEqual(['visible plain']);
    index.destroy();
  });

  it('fallback creation keeps an indented task after a closed quoted fence as a root', async () => {
    const content = [
      '- [ ] parent',
      '> ```md',
      '> code example',
      '> ```',
      '  - [ ] after boundary',
    ].join('\n');
    const app = await createAppWithFiles({ 'created.md': content });
    app.metadataCache.getFileCache = (): null => null;
    const index = new TaskIndex(app, {
      statusCatalog: canonicalStatusCatalog(),
      dailyNoteFormat: 'YYYY-MM-DD',
    });
    const fireCreate = captureCreateCallback(app);
    await index.initialize();

    fireCreate(mdFile(app, 'created.md'));
    await flushMicrotasks();

    const tasks = index.list();
    expect(tasks.map((task) => task.title)).toEqual(['parent', 'after boundary']);
    expect(tasks[0]?.subtasks).toEqual([]);
    index.destroy();
  });

  it('fallback creation treats a same-depth root fence as a non-list boundary', async () => {
    const content = ['- [ ] parent', '```md', 'code example', '```', '  - [ ] after boundary'].join(
      '\n',
    );
    const app = await createAppWithFiles({ 'created.md': content });
    app.metadataCache.getFileCache = (): null => null;
    const index = new TaskIndex(app, {
      statusCatalog: canonicalStatusCatalog(),
      dailyNoteFormat: 'YYYY-MM-DD',
    });
    const fireCreate = captureCreateCallback(app);
    await index.initialize();

    fireCreate(mdFile(app, 'created.md'));
    await flushMicrotasks();

    const tasks = index.list();
    expect(tasks.map((task) => task.title)).toEqual(['parent', 'after boundary']);
    expect(tasks[0]?.subtasks).toEqual([]);
    index.destroy();
  });

  it('fallback creation preserves hierarchy across a list-indented fence', async () => {
    const content = [
      '- [ ] parent',
      '  ```md',
      '  code example',
      '  ```',
      '  - [ ] child after fence',
    ].join('\n');
    const app = await createAppWithFiles({ 'created.md': content });
    app.metadataCache.getFileCache = (): null => null;
    const index = new TaskIndex(app, {
      statusCatalog: canonicalStatusCatalog(),
      dailyNoteFormat: 'YYYY-MM-DD',
    });
    const fireCreate = captureCreateCallback(app);
    await index.initialize();

    fireCreate(mdFile(app, 'created.md'));
    await flushMicrotasks();

    const tasks = index.list();
    expect(tasks.map((task) => task.title)).toEqual(['parent']);
    expect(tasks[0]?.subtasks.map((task) => task.title)).toEqual(['child after fence']);
    index.destroy();
  });

  it('keeps a metadata modification that arrives during a blocked initial read', async () => {
    const { app, index, fireChanged } = await setup({ 'blocked.md': '- [ ] stale' });
    const read = blockRead(app, 'blocked.md', '- [ ] stale');

    const initializing = index.initialize();
    await read.started;
    fireChanged(mdFile(app, 'blocked.md'), '- [ ] current', taskCache());
    read.release();
    await initializing;

    expect(index.list().map((task) => task.title)).toEqual(['current']);
    index.destroy();
  });

  it('keeps a delete that arrives during a blocked initial read', async () => {
    const { app, index } = await setup({ 'blocked.md': '- [ ] stale' });
    const read = blockRead(app, 'blocked.md', '- [ ] stale');

    const initializing = index.initialize();
    await read.started;
    await app.vault.delete(mdFile(app, 'blocked.md'));
    read.release();
    await initializing;

    expect(index.list()).toEqual([]);
    index.destroy();
  });

  it('keeps a markdown-to-non-markdown rename during a blocked initial read', async () => {
    const { app, index } = await setup({ 'blocked.md': '- [ ] stale' });
    const read = blockRead(app, 'blocked.md', '- [ ] stale');

    const initializing = index.initialize();
    await read.started;
    await app.vault.rename(mdFile(app, 'blocked.md'), 'blocked.txt');
    read.release();
    await initializing;

    expect(index.list()).toEqual([]);
    index.destroy();
  });

  it('indexes the new path after a markdown rename during a blocked initial read', async () => {
    const { app, index } = await setup({ 'blocked.md': '- [ ] renamed task' });
    const read = blockRead(app, 'blocked.md', '- [ ] renamed task');

    const initializing = index.initialize();
    await read.started;
    await app.vault.rename(mdFile(app, 'blocked.md'), 'renamed.md');
    read.release();
    await initializing;

    expect(index.list().map((task) => [task.source.filePath, task.title])).toEqual([
      ['renamed.md', 'renamed task'],
    ]);
    index.destroy();
  });

  it('invalidates a create read after newer metadata and transfers the current snapshot on rename', async () => {
    const { app, index, fireChanged } = await setup({ 'created.md': '- [ ] initial' });
    const fireCreate = captureCreateCallback(app);
    await index.initialize();
    const read = blockRead(app, 'created.md', '- [ ] stale create');
    const events: unknown[] = [];
    index.subscribe((event) => events.push(event));

    const created = mdFile(app, 'created.md');
    fireCreate(created);
    await read.started;
    fireChanged(created, '- [ ] current metadata', taskCache());
    expect(index.list().map((task) => task.title)).toEqual(['current metadata']);
    await app.vault.rename(created, 'renamed.md');
    expect(index.list().map((task) => task.title)).toEqual(['current metadata']);
    read.release();
    await flushMicrotasks();

    expect(index.list().map((task) => [task.source.filePath, task.title])).toEqual([
      ['renamed.md', 'current metadata'],
    ]);
    expect(events.filter((event) => (event as { type: string }).type === 'renamed')).toEqual([
      { type: 'renamed', oldPath: 'created.md', newPath: 'renamed.md' },
    ]);
    expect(events).not.toContainEqual({ type: 'changed', files: ['renamed.md'] });
    index.destroy();
  });

  it('invalidates a create read when the file is deleted', async () => {
    const { app, index } = await setup({ 'created.md': '- [ ] indexed' });
    const fireCreate = captureCreateCallback(app);
    await index.initialize();
    const read = blockRead(app, 'created.md', '- [ ] stale create');

    const created = mdFile(app, 'created.md');
    fireCreate(created);
    await read.started;
    await app.vault.delete(created);
    read.release();
    await flushMicrotasks();

    expect(index.list()).toEqual([]);
    index.destroy();
  });

  it('ignores stale metadata after delete without publishing changed after deleted', async () => {
    const { app, index, fireChanged } = await setup({ 'deleted.md': '- [ ] current' });
    await index.initialize();
    const file = mdFile(app, 'deleted.md');
    const events: unknown[] = [];
    index.subscribe((event) => events.push(event));

    await app.vault.delete(file);
    fireChanged(file, '- [ ] stale metadata', taskCache());
    await flushMicrotasks();

    expect(index.list()).toEqual([]);
    expect(events).toEqual([{ type: 'deleted', path: 'deleted.md' }]);
    index.destroy();
  });

  it('recomputes the daily-note date after a markdown rename', async () => {
    const { app, index } = await setup({ '2026-07-01.md': '- [ ] daily task' });
    await index.initialize();

    await app.vault.rename(mdFile(app, '2026-07-01.md'), '2026-07-02.md');

    expect(index.list()[0]?.presentation.dailyNoteDate).toBe('2026-07-02');
    index.destroy();
  });

  it('removes tasks and publishes rename when markdown becomes non-markdown', async () => {
    const { app, index } = await setup({ 'task.md': '- [ ] task' });
    await index.initialize();
    const events: unknown[] = [];
    index.subscribe((event) => events.push(event));

    await app.vault.rename(mdFile(app, 'task.md'), 'task.txt');

    expect(index.list()).toEqual([]);
    expect(events).toEqual([{ type: 'renamed', oldPath: 'task.md', newPath: 'task.txt' }]);
    index.destroy();
  });

  it('safely indexes content when a non-markdown file becomes markdown', async () => {
    const { app, index } = await setup({ 'task.txt': '- [ ] newly markdown' });
    await index.initialize();
    const file = app.vault.getAbstractFileByPath('task.txt');
    if (!(file instanceof TFile)) throw new Error('missing task.txt');
    const events: unknown[] = [];
    index.subscribe((event) => events.push(event));

    await app.vault.rename(file, 'task.md');
    await flushMicrotasks();

    expect(index.list().map((task) => [task.source.filePath, task.title])).toEqual([
      ['task.md', 'newly markdown'],
    ]);
    expect(events).toEqual([{ type: 'renamed', oldPath: 'task.txt', newPath: 'task.md' }]);
    index.destroy();
  });

  it('fallback rename preserves quoted task hierarchy without duplicate roots', async () => {
    const content = [
      '> [!todo] Tasks',
      '> - [ ] quoted parent',
      '>   - [ ] quoted child',
      '> - [ ] quoted sibling',
    ].join('\n');
    const { app, index } = await setup({ 'callout.txt': content });
    await index.initialize();
    const file = app.vault.getAbstractFileByPath('callout.txt');
    if (!(file instanceof TFile)) throw new Error('missing callout.txt');

    await app.vault.rename(file, 'callout.md');
    await flushMicrotasks();

    const tasks = index.list();
    expect(tasks.map((task) => task.title)).toEqual(['quoted parent', 'quoted sibling']);
    expect(tasks[0]?.subtasks.map((task) => task.title)).toEqual(['quoted child']);
    index.destroy();
  });

  it('fallback rename does not close an outer fence from a deeper quote container', async () => {
    const content = [
      '> [!example] Fenced tasks',
      '> ```md',
      '> > ```',
      '> > - [ ] hidden deeper example',
      '> - [ ] hidden outer example',
      '> ```',
      '- [ ] visible root',
    ].join('\n');
    const app = await createAppWithFiles({ 'examples.txt': content });
    app.metadataCache.getFileCache = (): null => null;
    const index = new TaskIndex(app, {
      statusCatalog: canonicalStatusCatalog(),
      dailyNoteFormat: 'YYYY-MM-DD',
    });
    await index.initialize();
    const file = app.vault.getAbstractFileByPath('examples.txt');
    if (!(file instanceof TFile)) throw new Error('missing examples.txt');

    await app.vault.rename(file, 'examples.md');
    await flushMicrotasks();

    expect(index.list().map((task) => task.title)).toEqual(['visible root']);
    index.destroy();
  });

  it('fallback rename keeps an indented task after a closed quoted fence as a root', async () => {
    const content = [
      '- [ ] parent',
      '> ~~~md',
      '> callout code example',
      '> ~~~',
      '  - [ ] after boundary',
    ].join('\n');
    const app = await createAppWithFiles({ 'examples.txt': content });
    app.metadataCache.getFileCache = (): null => null;
    const index = new TaskIndex(app, {
      statusCatalog: canonicalStatusCatalog(),
      dailyNoteFormat: 'YYYY-MM-DD',
    });
    await index.initialize();
    const file = app.vault.getAbstractFileByPath('examples.txt');
    if (!(file instanceof TFile)) throw new Error('missing examples.txt');

    await app.vault.rename(file, 'examples.md');
    await flushMicrotasks();

    const tasks = index.list();
    expect(tasks.map((task) => task.title)).toEqual(['parent', 'after boundary']);
    expect(tasks[0]?.subtasks).toEqual([]);
    index.destroy();
  });

  it('fallback rename treats a same-depth quoted fence as a non-list boundary', async () => {
    const content = [
      '> - [ ] parent',
      '> ~~~md',
      '> code example',
      '> ~~~',
      '>   - [ ] after boundary',
    ].join('\n');
    const app = await createAppWithFiles({ 'examples.txt': content });
    app.metadataCache.getFileCache = (): null => null;
    const index = new TaskIndex(app, {
      statusCatalog: canonicalStatusCatalog(),
      dailyNoteFormat: 'YYYY-MM-DD',
    });
    await index.initialize();
    const file = app.vault.getAbstractFileByPath('examples.txt');
    if (!(file instanceof TFile)) throw new Error('missing examples.txt');

    await app.vault.rename(file, 'examples.md');
    await flushMicrotasks();

    const tasks = index.list();
    expect(tasks.map((task) => task.title)).toEqual(['parent', 'after boundary']);
    expect(tasks[0]?.subtasks).toEqual([]);
    index.destroy();
  });

  it('fallback hierarchy does not cross quote-container boundaries', async () => {
    const content = [
      '- [ ] plain parent',
      '> - [ ] quoted boundary',
      '  - [ ] plain after boundary',
    ].join('\n');
    const { app, index } = await setup({ 'boundaries.txt': content });
    await index.initialize();
    const file = app.vault.getAbstractFileByPath('boundaries.txt');
    if (!(file instanceof TFile)) throw new Error('missing boundaries.txt');

    await app.vault.rename(file, 'boundaries.md');
    await flushMicrotasks();

    expect(index.list().map((task) => task.title)).toEqual([
      'plain parent',
      'quoted boundary',
      'plain after boundary',
    ]);
    index.destroy();
  });
});
