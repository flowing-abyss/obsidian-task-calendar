import { getAllTags, TFile, type App, type CachedMetadata, type TAbstractFile } from 'obsidian';
import type { Task } from '../parser/types';
import { evaluateQuery } from '../query/evaluateQuery';
import type { CalendarSettings } from '../settings/types';
import type { TaskIndexEvent, TaskQueryApi } from '../tasks';
import { legacyTaskViews } from '../tasks/compat/legacyTaskView';
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

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === 'md';
}

function wasMarkdown(path: string): boolean {
  const name = path.replace(/^.*\//u, '');
  const dot = name.lastIndexOf('.');
  return dot >= 0 && name.slice(dot + 1) === 'md';
}

/**
 * Enumerates and caches project notes (markdown files matching the membership
 * query), computing per-note task stats. Registers its own vault/metadata
 * listeners — it must NOT depend only on task-index events, because a project
 * note with no tasks is never in the task map and its create/delete/rename
 * would be missed.
 */
export class ProjectStore {
  private cache: Project[] = [];
  private byPath = new Map<string, Project>();
  private listeners: Array<() => void> = [];
  private eventUnsubs: Array<() => void> = [];
  private queryUnsub?: () => void;
  private debounce = 0;
  private pendingPaths = new Set<string>();
  private pendingFull = false;

  constructor(
    private app: App,
    private queries: TaskQueryApi,
    private settings: CalendarSettings,
  ) {}

  initialize(): void {
    this.recomputeAll();
    // A single note edit re-evaluates only that note (O(1) note + its tasks).
    // Create/delete/rename change the membership set → full rescan (rare events).
    const metadataRef = this.app.metadataCache.on('changed', (file) => {
      if (file.extension === 'md' && this.app.vault.getAbstractFileByPath(file.path) === file) {
        this.enqueueUpdate(file.path);
      }
    });
    this.eventUnsubs.push(() => this.app.metadataCache.offref(metadataRef));
    const createRef = this.app.vault.on('create', (file) => {
      if (isMarkdownFile(file)) this.enqueueFull();
    });
    const deleteRef = this.app.vault.on('delete', (file) => {
      if (isMarkdownFile(file)) this.enqueueFull();
    });
    const renameRef = this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && (file.extension === 'md' || wasMarkdown(oldPath))) {
        this.enqueueFull();
      }
    });
    this.eventUnsubs.push(
      () => this.app.vault.offref(createRef),
      () => this.app.vault.offref(deleteRef),
      () => this.app.vault.offref(renameRef),
    );
    this.queryUnsub = this.queries.subscribe((event) => this.onTaskIndexEvent(event));
  }

  private onTaskIndexEvent(event: TaskIndexEvent): void {
    if (event.type === 'changed') {
      for (const path of event.files) this.scheduleUpdate(path);
    } else if (event.type === 'initialized') {
      this.scheduleFull();
    } else {
      this.scheduleFull();
    }
  }

  private scheduleUpdate(path: string): void {
    this.enqueueUpdate(path);
    this.scheduleFlush();
  }

  private scheduleFull(): void {
    this.enqueueFull();
    this.scheduleFlush();
  }

  private enqueueUpdate(path: string): void {
    this.pendingPaths.add(path);
  }

  private enqueueFull(): void {
    this.pendingFull = true;
  }

  private scheduleFlush(): void {
    if (this.debounce) window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => this.flush(), 150);
  }

  private flush(): void {
    if (this.pendingFull) {
      this.recomputeAll();
    } else if (this.pendingPaths.size > 0) {
      for (const path of this.pendingPaths) this.updateOne(path);
      this.rebuildCache();
    }
    this.pendingFull = false;
    this.pendingPaths.clear();
    for (const cb of this.listeners) cb();
  }

  /** Full O(N + T) rescan of every markdown file. Used on init, create/delete/rename, refresh(). */
  private recomputeAll(): void {
    const tasksByPath = this.groupTasksByPath();
    this.byPath = new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const entry = this.makeEntry(file.path, cache, tasksByPath.get(file.path) ?? []);
      if (entry) this.byPath.set(file.path, entry);
    }
    this.rebuildCache();
  }

  /** Re-evaluate a single note in place — O(1 note + T for its task filter). */
  private updateOne(path: string): void {
    // Only markdown files are projects; folders/non-md drop out.
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') {
      this.byPath.delete(path);
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const tasks = legacyTaskViews(this.queries.list({ filePath: path }));
    const entry = this.makeEntry(path, cache, tasks);
    if (entry) this.byPath.set(path, entry);
    else this.byPath.delete(path);
  }

  private makeEntry(path: string, cache: CachedMetadata | null, tasks: Task[]): Project | null {
    const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const tags = (cache ? (getAllTags(cache) ?? []) : []).map((tag) => tag.toLowerCase());
    if (!evaluateQuery(this.settings.projects.membershipQuery, path, tags, fm)) return null;
    const { statusId, rawStatus } = resolveStatus(this.settings.projects.statuses, tags, fm);
    return {
      path,
      name: basename(path),
      frontmatter: fm,
      tags,
      statusId,
      rawStatus,
      stats: computeStats(tasks),
    };
  }

  private groupTasksByPath(): Map<string, Task[]> {
    const map = new Map<string, Task[]>();
    for (const t of legacyTaskViews(this.queries.list())) {
      const arr = map.get(t.filePath) ?? [];
      arr.push(t);
      map.set(t.filePath, arr);
    }
    return map;
  }

  private rebuildCache(): void {
    this.cache = Array.from(this.byPath.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
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
    this.recomputeAll();
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
    this.queryUnsub?.();
    this.queryUnsub = undefined;
    for (const unsubscribe of this.eventUnsubs) unsubscribe();
    this.eventUnsubs = [];
    this.listeners = [];
  }
}
