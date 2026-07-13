import { TFile } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../src/projects/ProjectStore';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { TaskIndexEvent, TaskQueryApi, TaskSnapshot } from '../src/tasks';

function tfile(path: string, extension = 'md'): TFile {
  return Object.assign(Object.create(TFile.prototype) as object, {
    path,
    extension,
  }) as TFile;
}

function task(status: TaskSnapshot['status']): TaskSnapshot {
  return {
    ref: { filePath: 'Projects/A.md', line: 0, revision: `rev:${status}` },
    title: status,
    markdownTitle: status,
    status,
    statusSymbol: status === 'done' ? 'x' : ' ',
    priority: 'F',
    planning: {},
    tags: [],
    subtasks: [],
    comments: [],
    source: { filePath: 'Projects/A.md', line: 0, originalMarkdown: `- [ ] ${status}` },
    presentation: { linkCount: 0 },
  };
}

function harness() {
  const file = tfile('Projects/A.md');
  const metadataChanged: Array<(file: TFile) => void> = [];
  const vaultHandlers = new Map<string, Array<() => void>>();
  const refs = new Set<object>();
  const offref = vi.fn((ref: object) => refs.delete(ref));
  const on = (event: string, listener: (...args: never[]) => void): object => {
    const ref = { event, listener };
    refs.add(ref);
    if (event === 'changed') metadataChanged.push(listener as unknown as (file: TFile) => void);
    else {
      const handlers = vaultHandlers.get(event) ?? [];
      handlers.push(listener as unknown as () => void);
      vaultHandlers.set(event, handlers);
    }
    return ref;
  };
  const getMarkdownFiles = vi.fn(() => [file]);
  const app = {
    vault: {
      getMarkdownFiles,
      getAbstractFileByPath: (path: string) => (path === file.path ? file : null),
      on,
      offref,
    },
    metadataCache: {
      getFileCache: () => ({ frontmatter: { status: 'active' } }),
      on,
      offref,
    },
  };
  let snapshots: readonly TaskSnapshot[] = [task('open')];
  let indexListener: ((event: TaskIndexEvent) => void) | undefined;
  const indexUnsub = vi.fn();
  const queries: TaskQueryApi = {
    list: () => snapshots,
    forCalendarDates: () => [],
    resolve: vi.fn(),
    subscribe: (listener) => {
      indexListener = listener;
      return indexUnsub;
    },
  };
  return {
    app: app as never,
    queries,
    metadata: (changedFile: TFile = file) => metadataChanged[0]?.(changedFile),
    vault: (
      event: 'create' | 'delete' | 'rename',
      changedFile: TFile = file,
      oldPath = 'Old.md',
    ) => {
      for (const listener of vaultHandlers.get(event) ?? []) {
        (listener as (...args: unknown[]) => void)(changedFile, oldPath);
      }
    },
    index: (event: TaskIndexEvent) => indexListener?.(event),
    setTasks: (next: readonly TaskSnapshot[]) => {
      snapshots = next;
    },
    indexUnsub,
    offref,
    getMarkdownFiles,
  };
}

afterEach(() => vi.useRealTimers());

describe('ProjectStore event convergence', () => {
  it.each(['metadata-first', 'index-first'] as const)(
    'coalesces %s delivery and publishes once from consistent index data',
    (order) => {
      vi.useFakeTimers();
      const h = harness();
      const store = new ProjectStore(h.app, h.queries, DEFAULT_SETTINGS);
      store.initialize();
      const listener = vi.fn();
      store.onUpdate(listener);
      h.setTasks([task('done')]);
      if (order === 'metadata-first') {
        h.metadata();
        h.index({ type: 'changed', files: ['Projects/A.md'] });
      } else {
        h.index({ type: 'changed', files: ['Projects/A.md'] });
        h.metadata();
      }
      vi.advanceTimersByTime(150);
      expect(store.get('Projects/A.md')?.stats.done).toBe(1);
      expect(listener).toHaveBeenCalledTimes(1);
      store.destroy();
    },
  );

  it('keeps an empty project note and unsubscribes index plus Obsidian streams', () => {
    const h = harness();
    h.setTasks([]);
    const store = new ProjectStore(h.app, h.queries, DEFAULT_SETTINGS);
    store.initialize();
    expect(store.get('Projects/A.md')).toBeDefined();
    store.destroy();
    expect(h.indexUnsub).toHaveBeenCalledTimes(1);
    expect(h.offref).toHaveBeenCalledTimes(4);
  });

  it('waits for a delayed task-index barrier before publishing metadata changes', () => {
    vi.useFakeTimers();
    const h = harness();
    const store = new ProjectStore(h.app, h.queries, DEFAULT_SETTINGS);
    store.initialize();
    const listener = vi.fn();
    store.onUpdate(listener);
    h.setTasks([task('done')]);
    h.metadata();
    vi.advanceTimersByTime(1_000);
    expect(listener).not.toHaveBeenCalled();
    expect(store.get('Projects/A.md')?.stats.done).toBe(0);
    h.index({ type: 'changed', files: ['Projects/A.md'] });
    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.get('Projects/A.md')?.stats.done).toBe(1);
    store.destroy();
  });

  it('ignores a stale markdown metadata event whose file is no longer current', () => {
    vi.useFakeTimers();
    const h = harness();
    const store = new ProjectStore(h.app, h.queries, DEFAULT_SETTINGS);
    store.initialize();
    h.setTasks([task('done')]);
    h.metadata(tfile('Projects/A.md'));
    h.index({ type: 'changed', files: ['Other.md'] });
    vi.advanceTimersByTime(150);
    expect(store.get('Projects/A.md')?.stats.done).toBe(0);
    store.destroy();
  });

  it.each(['create', 'rename'] as const)(
    'uses the task-index %s event as the full-rescan barrier',
    (event) => {
      vi.useFakeTimers();
      const h = harness();
      const store = new ProjectStore(h.app, h.queries, DEFAULT_SETTINGS);
      store.initialize();
      const listener = vi.fn();
      store.onUpdate(listener);
      h.vault(event);
      vi.advanceTimersByTime(1_000);
      expect(listener).not.toHaveBeenCalled();
      if (event === 'create') h.index({ type: 'changed', files: ['Projects/A.md'] });
      else h.index({ type: 'renamed', oldPath: 'Old.md', newPath: 'Projects/A.md' });
      vi.advanceTimersByTime(150);
      expect(listener).toHaveBeenCalledOnce();
      expect(store.get('Projects/A.md')).toBeDefined();
      store.destroy();
    },
  );

  it.each(['create', 'delete', 'rename'] as const)(
    'ignores attachment %s so an unrelated task event cannot flush a latent full rescan',
    (event) => {
      vi.useFakeTimers();
      const h = harness();
      const store = new ProjectStore(h.app, h.queries, DEFAULT_SETTINGS);
      store.initialize();
      h.vault(event, tfile('asset.png', 'png'), 'old-asset.png');
      h.index({ type: 'changed', files: ['Projects/A.md'] });
      vi.advanceTimersByTime(150);
      expect(h.getMarkdownFiles).toHaveBeenCalledOnce();
      store.destroy();
    },
  );

  it('treats a markdown-to-attachment rename as a full-rescan event', () => {
    vi.useFakeTimers();
    const h = harness();
    const store = new ProjectStore(h.app, h.queries, DEFAULT_SETTINGS);
    store.initialize();
    h.vault('rename', tfile('Projects/A.png', 'png'), 'Projects/A.md');
    vi.advanceTimersByTime(1_000);
    expect(h.getMarkdownFiles).toHaveBeenCalledOnce();
    h.index({ type: 'renamed', oldPath: 'Projects/A.md', newPath: 'Projects/A.png' });
    vi.advanceTimersByTime(150);
    expect(h.getMarkdownFiles).toHaveBeenCalledTimes(2);
    store.destroy();
  });
});
