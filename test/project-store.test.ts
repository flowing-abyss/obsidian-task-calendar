import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/parser/types';
import { computeStats, ProjectStore } from '../src/projects/ProjectStore';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';

function t(over: Partial<Task>): Task {
  return {
    filePath: 'x.md',
    line: 0,
    rawText: '',
    text: '',
    markdownText: '',
    status: 'open',
    priority: 'none',
    ...over,
  } as Task;
}

describe('computeStats', () => {
  it('counts task statuses', () => {
    const stats = computeStats([
      t({ status: 'open' }),
      t({ status: 'done' }),
      t({ status: 'done' }),
      t({ status: 'cancelled' }),
      t({ status: 'in-progress' }),
    ]);
    expect(stats).toEqual({ total: 5, done: 2, cancelled: 1, inProgress: 1 });
  });

  it('handles an empty list', () => {
    expect(computeStats([])).toEqual({ total: 0, done: 0, cancelled: 0, inProgress: 0 });
  });
});

interface FakeFile {
  path: string;
  tags: string[]; // '#'-prefixed inline tags
  fm: Record<string, unknown>;
}

function makeApp(files: FakeFile[]): { app: never; fire: (event: string) => void } {
  const tfiles = files.map((f) => ({ path: f.path, extension: 'md' }));
  const cacheByPath = new Map(
    files.map((f) => [
      f.path,
      // Shape consumed by Obsidian getAllTags: inline tags under `tags[].tag`,
      // frontmatter under `frontmatter` (frontmatter `tags` also honored by getAllTags).
      { frontmatter: f.fm, tags: f.tags.map((tag) => ({ tag })) },
    ]),
  );
  const handlers: Record<string, Array<() => void>> = {};
  const on = (event: string, cb: () => void): { event: string } => {
    (handlers[event] ??= []).push(cb);
    return { event };
  };
  const app = {
    vault: {
      getMarkdownFiles: () => tfiles,
      on,
      offref: vi.fn(),
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => cacheByPath.get(file.path),
      on,
      offref: vi.fn(),
    },
  } as never;
  const fire = (event: string): void => {
    for (const cb of handlers[event] ?? []) cb();
  };
  return { app, fire };
}

function storeWith(tasks: Task[]): never {
  return { getTasks: () => tasks } as never;
}

describe('ProjectStore enumeration', () => {
  it('lists only notes matching the membership query and resolves status', () => {
    const { app } = makeApp([
      { path: 'Projects/A.md', tags: [], fm: { status: 'active' } },
      { path: 'Projects/B.md', tags: [], fm: { status: 'archive' } },
      { path: 'Notes/C.md', tags: [], fm: {} },
    ]);
    const ps = new ProjectStore(app, storeWith([]), { ...DEFAULT_SETTINGS });
    ps.initialize();
    const list = ps.list();
    expect(list.map((p) => p.path).sort()).toEqual(['Projects/A.md', 'Projects/B.md']);
    const a = ps.get('Projects/A.md')!;
    expect(a.statusId).toBe(DEFAULT_SETTINGS.projects.statuses[0]!.id);
    const b = ps.get('Projects/B.md')!;
    expect(b.statusId).toBeNull();
    expect(b.rawStatus).toBe('archive');
    ps.destroy();
  });

  it('computes stats from tasks in the note', () => {
    const { app } = makeApp([{ path: 'Projects/A.md', tags: [], fm: { status: 'active' } }]);
    const tasks = [
      t({ filePath: 'Projects/A.md', status: 'open' }),
      t({ filePath: 'Projects/A.md', status: 'done' }),
      t({ filePath: 'Other.md', status: 'open' }),
    ];
    const ps = new ProjectStore(app, storeWith(tasks), { ...DEFAULT_SETTINGS });
    ps.initialize();
    expect(ps.get('Projects/A.md')!.stats).toEqual({
      total: 2,
      done: 1,
      cancelled: 0,
      inProgress: 0,
    });
    ps.destroy();
  });

  it('activeForLeftPanel returns only onLeftPanel statuses', () => {
    const { app } = makeApp([
      { path: 'Projects/A.md', tags: [], fm: { status: 'active' } }, // onLeftPanel true
      { path: 'Projects/D.md', tags: [], fm: { status: 'done' } }, // onLeftPanel false
    ]);
    const ps = new ProjectStore(app, storeWith([]), { ...DEFAULT_SETTINGS });
    ps.initialize();
    expect(ps.activeForLeftPanel().map((p) => p.path)).toEqual(['Projects/A.md']);
    ps.destroy();
  });

  it('notifies listeners on refresh', () => {
    const { app } = makeApp([{ path: 'Projects/A.md', tags: [], fm: { status: 'active' } }]);
    const ps = new ProjectStore(app, storeWith([]), { ...DEFAULT_SETTINGS });
    ps.initialize();
    const cb = vi.fn();
    ps.onUpdate(cb);
    ps.refresh();
    expect(cb).toHaveBeenCalledTimes(1);
    ps.destroy();
  });
});
