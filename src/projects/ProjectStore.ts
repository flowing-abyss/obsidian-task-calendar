import { getAllTags, type App, type EventRef } from 'obsidian';
import type { Task } from '../parser/types';
import { evaluateQuery } from '../query/evaluateQuery';
import type { CalendarSettings } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';
import { resolveStatus } from './status';
import type { Project, ProjectStats } from './types';

export function computeStats(tasks: Task[]): ProjectStats {
  let done = 0;
  let cancelled = 0;
  let inProgress = 0;
  for (const t of tasks) {
    if (t.status === 'done') done++;
    else if (t.status === 'cancelled') cancelled++;
    else if (t.status === 'in-progress') inProgress++;
  }
  return { total: tasks.length, done, cancelled, inProgress };
}

function basename(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.md$/, '');
}

/**
 * Enumerates and caches project notes (markdown files matching the membership
 * query), computing per-note task stats. Registers its own vault/metadata
 * listeners — it must NOT piggyback on TaskStore.onUpdate, because a project
 * note with no tasks is never in the task map and its create/delete/rename
 * would be missed.
 */
export class ProjectStore {
  private cache: Project[] = [];
  private byPath = new Map<string, Project>();
  private listeners: Array<() => void> = [];
  private refs: EventRef[] = [];
  private debounce = 0;

  constructor(
    private app: App,
    private store: TaskStore,
    private settings: CalendarSettings,
  ) {}

  initialize(): void {
    this.recompute();
    const bump = (): void => this.scheduleRecompute();
    this.refs.push(this.app.metadataCache.on('changed', bump));
    this.refs.push(this.app.vault.on('create', bump));
    this.refs.push(this.app.vault.on('delete', bump));
    this.refs.push(this.app.vault.on('rename', bump));
  }

  private scheduleRecompute(): void {
    if (this.debounce) window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => {
      this.recompute();
      for (const cb of this.listeners) cb();
    }, 150);
  }

  private recompute(): void {
    const q = this.settings.projects.membershipQuery;
    const statuses = this.settings.projects.statuses;
    const tasks = this.store.getTasks();
    const tasksByPath = new Map<string, Task[]>();
    for (const t of tasks) {
      const arr = tasksByPath.get(t.filePath) ?? [];
      arr.push(t);
      tasksByPath.set(t.filePath, arr);
    }
    const out: Project[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const f = file;
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
      const tags = (cache ? (getAllTags(cache) ?? []) : []).map((tag) => tag.toLowerCase());
      if (!evaluateQuery(q, f.path, tags, fm)) continue;
      const { statusId, rawStatus } = resolveStatus(statuses, tags, fm);
      out.push({
        path: f.path,
        name: basename(f.path),
        frontmatter: fm,
        tags,
        statusId,
        rawStatus,
        stats: computeStats(tasksByPath.get(f.path) ?? []),
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    this.cache = out;
    this.byPath = new Map(out.map((p) => [p.path, p]));
  }

  list(): Project[] {
    return this.cache;
  }

  get(path: string): Project | undefined {
    return this.byPath.get(path);
  }

  activeForLeftPanel(): Project[] {
    const onPanel = new Set(
      this.settings.projects.statuses.filter((s) => s.onLeftPanel).map((s) => s.id),
    );
    return this.cache.filter((p) => p.statusId !== null && onPanel.has(p.statusId));
  }

  refresh(): void {
    this.recompute();
    for (const cb of this.listeners) cb();
  }

  onUpdate(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  destroy(): void {
    if (this.debounce) window.clearTimeout(this.debounce);
    for (const ref of this.refs) {
      this.app.metadataCache.offref(ref);
      this.app.vault.offref(ref);
    }
    this.refs = [];
    this.listeners = [];
  }
}
