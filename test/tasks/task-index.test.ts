import { TFile, type CachedMetadata } from 'obsidian';
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

describe('TaskIndex lifecycle and events', () => {
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
});
