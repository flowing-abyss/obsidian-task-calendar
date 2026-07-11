import {
  Notice,
  TFile,
  type App,
  type CachedMetadata,
  type EventRef,
  type TAbstractFile,
} from 'obsidian';
import { locatorOf, TaskMutationService } from '../mutation';
import { countLinksIn } from '../parser/links';
import { parseSubItems } from '../parser/SubItemParser';
import { parseTask } from '../parser/TaskParser';
import type { Task, TaskFilter, TaskPriority } from '../parser/types';
import { DailyNoteResolver } from '../resolvers/DailyNoteResolver';
import type { CalendarSettings } from '../settings/types';
import { StatusRegistry } from '../status/StatusRegistry';
import { TaskDateIndex } from './TaskDateIndex';

export interface StoreUpdateEvent {
  changedFiles: string[]; // empty = bulk init complete, no specific file
}

type UpdateCallback = (event: StoreUpdateEvent) => void;

function momentToRegex(fmt: string): RegExp {
  const escaped = fmt
    .replace(/\./g, '\\.')
    .replace(/,/g, '\\,')
    .replace(/-/g, '\\-')
    .replace(/:/g, '\\:')
    .replace(/ /g, '\\s')
    .replace('dddd', '\\w{4,}')
    .replace('ddd', '\\w{1,3}')
    .replace('dd', '\\w{2}')
    .replace('YYYY', '\\d{4}')
    .replace('YY', '\\d{2}')
    .replace('MMMM', '\\w{4,}')
    .replace('MMM', '\\w{3}')
    .replace('MM', '\\d{2}')
    .replace('DD', '\\d{2}')
    .replace('D', '\\d{1,2}')
    .replace('ww', '\\d{1,2}');
  return new RegExp(`^(${escaped})$`);
}

export class TaskStore {
  private taskMap = new Map<string, Task[]>();
  private dateIndex = new TaskDateIndex();
  private frontmatterMap = new Map<string, { color?: string; textColor?: string; icon?: string }>();
  private listeners: UpdateCallback[] = [];
  private pendingFiles = new Set<string>();
  private flushScheduled = false;
  private metadataCacheRefs: EventRef[] = [];
  private vaultRefs: EventRef[] = [];
  private resolver: DailyNoteResolver;
  private mutations: TaskMutationService;
  statusRegistry: StatusRegistry;

  constructor(
    private app: App,
    private settings: CalendarSettings,
  ) {
    this.resolver = new DailyNoteResolver(app, settings);
    this.statusRegistry = new StatusRegistry(this.settings.taskStatuses);
    this.mutations = new TaskMutationService(app, () => this.statusRegistry);
  }

  /** Rebuild the status registry from current settings. Call after settings edits. */
  rebuildStatusRegistry(): void {
    this.statusRegistry = new StatusRegistry(this.settings.taskStatuses);
  }

  async initialize(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const CHUNK_SIZE = 50;
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map((f) => this.loadFile(f)));
      // Yield to event loop between chunks
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });
    }
    this.notify({ changedFile: undefined });
    this.registerEvents();
  }

  private async loadFile(file: TFile): Promise<void> {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.listItems?.some((item) => item.task !== undefined)) return;
      const content = await this.app.vault.cachedRead(file);
      const fm = cache.frontmatter;
      if (fm) {
        this.frontmatterMap.set(file.path, {
          color: typeof fm['color'] === 'string' ? fm['color'] : undefined,
          textColor: typeof fm['textColor'] === 'string' ? fm['textColor'] : undefined,
          icon: typeof fm['icon'] === 'string' ? fm['icon'] : undefined,
        });
      }
      this.parseFileTasks(file.path, content, cache);
    } catch {
      // File may have been deleted; skip silently
    }
  }

  private parseFileTasks(filePath: string, content: string, cache: CachedMetadata): void {
    if (!cache.listItems) {
      this.taskMap.delete(filePath);
      this.dateIndex.removeFile(filePath);
      return;
    }
    const lines = content.split('\n');
    const dailyNoteFormat = this.settings.desktop.dailyNoteFormat;
    const dailyNoteRegex = momentToRegex(dailyNoteFormat);
    const filename = filePath.replace(/^.*\//, '').replace(/\.[^.]*$/, '');
    const dailyNoteDate = dailyNoteRegex.test(filename)
      ? window.moment(filename, dailyNoteFormat).format('YYYY-MM-DD')
      : undefined;

    const tasks: Task[] = [];
    const fm = this.frontmatterMap.get(filePath);
    // Index list items by their start line so we can walk the parent chain.
    // Obsidian's `parent` is the line of the parent list item (≥ 0), or a negative
    // value for root-level items.
    const itemByLine = new Map<number, (typeof cache.listItems)[number]>();
    for (const item of cache.listItems) itemByLine.set(item.position.start.line, item);
    const hasTaskAncestor = (item: (typeof cache.listItems)[number]): boolean => {
      let parentLine = item.parent;
      // `seen` guards against malformed/cyclic cache data (e.g. a self- or
      // mutually-referential `parent`), which would otherwise spin forever.
      const seen = new Set<number>();
      while (parentLine >= 0 && !seen.has(parentLine)) {
        seen.add(parentLine);
        const parent = itemByLine.get(parentLine);
        if (!parent) break;
        if (parent.task !== undefined) return true;
        parentLine = parent.parent;
      }
      return false;
    };
    for (const item of cache.listItems) {
      if (item.task === undefined) continue;
      // Skip child items only when they descend from an actual task — those are
      // parsed as sub-tasks by parseSubItems. A checkbox nested under a plain
      // (non-task) bullet has no task ancestor, so it is an independent task.
      if (hasTaskAncestor(item)) continue;
      const lineIdx = item.position.start.line;
      const rawText = lines[lineIdx] ?? '';
      const task = parseTask(rawText, {
        filePath,
        line: lineIdx,
        dailyNoteDate,
        globalTaskFilter: this.settings.desktop.globalTaskFilter || undefined,
        statusRegistry: this.statusRegistry,
      });
      if (task) {
        task.noteColor = fm?.color;
        task.noteTextColor = fm?.textColor;
        task.noteIcon = fm?.icon;
        // Parse sub-items (sub-tasks, comments, description)
        const sub = parseSubItems(lines, lineIdx, filePath, this.statusRegistry);
        if (sub.subtasks.length) task.subtasks = sub.subtasks;
        if (sub.comments.length) task.comments = sub.comments;
        if (sub.description) task.description = sub.description;
        if (sub.subtaskRange) task.subtaskRange = sub.subtaskRange;
        // Precompute the attached-materials link count once (not per render).
        task.linkCount = countLinksIn([
          task.markdownText,
          sub.description,
          ...sub.comments.map((c) => c.text),
        ]);
        tasks.push(task);
      }
    }
    if (tasks.length > 0) {
      this.taskMap.set(filePath, tasks);
    } else {
      this.taskMap.delete(filePath);
    }
    this.dateIndex.updateFile(filePath, tasks);
  }

  private registerEvents(): void {
    const onChanged = this.app.metadataCache.on(
      'changed',
      (file: TFile, data: string, cache: CachedMetadata) => {
        if (file.extension !== 'md') return;
        // Guard against stale events fired after a rename: if the vault no longer
        // has this file at this path, clear any ghost entry and skip reindexing.
        if (!this.app.vault.getAbstractFileByPath(file.path)) {
          this.taskMap.delete(file.path);
          return;
        }
        const fm = cache.frontmatter;
        if (fm) {
          this.frontmatterMap.set(file.path, {
            color: typeof fm['color'] === 'string' ? fm['color'] : undefined,
            textColor: typeof fm['textColor'] === 'string' ? fm['textColor'] : undefined,
            icon: typeof fm['icon'] === 'string' ? fm['icon'] : undefined,
          });
        }
        this.parseFileTasks(file.path, data, cache);
        this.notify({ changedFile: file.path });
      },
    );
    this.metadataCacheRefs.push(onChanged);

    const onRename = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      const tasks = this.taskMap.get(oldPath);
      if (tasks) {
        const updated = tasks.map((t) => ({ ...t, filePath: file.path }));
        this.taskMap.delete(oldPath);
        this.taskMap.set(file.path, updated);
        this.dateIndex.removeFile(oldPath);
        this.dateIndex.updateFile(file.path, updated);
      }
      const fm = this.frontmatterMap.get(oldPath);
      if (fm) {
        this.frontmatterMap.delete(oldPath);
        this.frontmatterMap.set(file.path, fm);
      }
      this.notify({ changedFile: file.path });
    });
    this.vaultRefs.push(onRename);

    const onDelete = this.app.vault.on('delete', (file: TAbstractFile) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      if (this.taskMap.delete(file.path)) {
        this.dateIndex.removeFile(file.path);
        this.frontmatterMap.delete(file.path);
        this.notify({ changedFile: file.path });
      }
    });
    this.vaultRefs.push(onDelete);
  }

  getTasks(filter?: TaskFilter): Task[] {
    // Fast path: file-only filter avoids flattening the entire index.
    if (
      filter?.filePath &&
      !filter.folder &&
      !filter.tag &&
      !filter.status?.length &&
      !filter.dateRange
    ) {
      return [...(this.taskMap.get(filter.filePath) ?? [])];
    }
    let all = Array.from(this.taskMap.values()).flat();
    if (!filter) return all;
    if (filter.filePath) all = all.filter((t) => t.filePath === filter.filePath);
    if (filter.folder) all = all.filter((t) => t.filePath.startsWith(filter.folder!));
    if (filter.tag) all = all.filter((t) => t.rawText.includes(filter.tag!));
    if (filter.status?.length) all = all.filter((t) => filter.status!.includes(t.status));
    if (filter.dateRange) {
      const { from, to } = filter.dateRange;
      all = all.filter((t) => {
        const date = t.due ?? t.scheduled ?? t.start ?? t.dailyNoteDate;
        return date ? date >= from && date <= to : false;
      });
    }
    return all;
  }

  /** O(1) lookup of tasks anchored on `date` (scheduled ?? due for plain tasks; every day in a start->due span). */
  getTasksForDate(date: string): Task[] {
    return this.dateIndex.getTasksForDate(date);
  }

  /** Dedup union of getTasksForDate across `dates` — for scoping a render to a visible date range (e.g. a month grid). */
  getTasksForDateRange(dates: string[]): Task[] {
    const seen = new Set<Task>();
    for (const date of dates) {
      for (const task of this.dateIndex.getTasksForDate(date)) seen.add(task);
    }
    return [...seen];
  }

  async toggleTask(task: Task): Promise<void> {
    const today = window.moment().format('YYYY-MM-DD');
    try {
      await this.mutations.toggleCompletion(locatorOf(task), today);
    } catch {
      new Notice('Failed to update task. Please try again.');
    }
  }

  /** Rewrite the task's status marker character, stamping/stripping ✅/❌ as needed. */
  async setTaskStatus(task: Task, char: string): Promise<void> {
    const today = window.moment().format('YYYY-MM-DD');
    try {
      await this.mutations.setStatusChar(locatorOf(task), char, today);
    } catch {
      new Notice('Failed to update task. Please try again.');
    }
  }

  /** Rewrite the task's priority emoji. */
  async setPriority(task: Task, priority: TaskPriority): Promise<void> {
    try {
      await this.mutations.setPriority(locatorOf(task), priority);
    } catch {
      new Notice('Failed to update task. Please try again.');
    }
  }

  async addTask(date: string, text: string): Promise<void> {
    if (this.settings.addToToday) {
      await this.resolver.addTask(text, date);
      return;
    }

    if (this.settings.customFilePath) {
      const filePath = this.settings.customFilePath;
      let file: TFile | null = null;
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing instanceof TFile) {
        file = existing;
      } else {
        await this.app.vault.create(filePath, '');
        const found = this.app.vault.getAbstractFileByPath(filePath);
        if (found instanceof TFile) file = found;
      }
      if (!file) {
        new Notice('No target file found for task.');
        return;
      }
      const prefix = this.settings.taskPrefix.trim();
      const taskLine = `- [ ] ${prefix ? prefix + ' ' : ''}${text} 📅 ${date}`;
      await this.app.vault.process(file, (data) => data + '\n' + taskLine);
      new Notice('Task added to ' + file.name);
      return;
    }

    new Notice('No target file found for task.');
  }

  async addRawLine(rawLine: string): Promise<void> {
    await this.resolver.appendLine(rawLine);
  }

  onUpdate(callback: UpdateCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private notify(event: { changedFile?: string }): void {
    if (event.changedFile) this.pendingFiles.add(event.changedFile);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    void Promise.resolve().then(() => {
      this.flushScheduled = false;
      const changedFiles = [...this.pendingFiles];
      this.pendingFiles.clear();
      // Task 31: snapshot before iterating. A listener's callback may itself register a new
      // listener as a side effect (e.g. CenterPanel destroying + re-subscribing its own
      // store.onUpdate on every calendar-mode render) — iterating the live `this.listeners`
      // array directly would pick up that newly-appended listener and fire it again within this
      // same flush, causing a redundant re-render that reads not-yet-settled state from the
      // first one.
      for (const cb of [...this.listeners]) cb({ changedFiles });
    });
  }

  destroy(): void {
    for (const ref of this.metadataCacheRefs) this.app.metadataCache.offref(ref);
    for (const ref of this.vaultRefs) this.app.vault.offref(ref);
    this.metadataCacheRefs = [];
    this.vaultRefs = [];
    this.listeners = [];
    this.taskMap.clear();
    this.dateIndex.clear();
    this.frontmatterMap.clear();
  }
}
