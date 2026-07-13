import { TFile, type App, type CachedMetadata, type EventRef, type TAbstractFile } from 'obsidian';
import { countLinksIn } from '../../parser/links';
import { parseSubItems } from '../../parser/SubItemParser';
import { parseTask } from '../../parser/TaskParser';
import type { SubTask, TaskComment } from '../../parser/types';
import type {
  TaskIndexEvent,
  TaskQuery,
  TaskQueryApi,
  TaskResolution,
  TaskResolutionCandidate,
} from '../application/TaskApplicationApi';
import type { StatusCatalog } from '../domain/StatusCatalog';
import type {
  CommentRef,
  DurationMinutes,
  LocalDate,
  LocalTime,
  SubtaskPlanning,
  SubtaskSnapshot,
  TaskCommentSnapshot,
  TaskNodeRef,
  TaskPlanning,
  TaskRef,
  TaskSnapshot,
} from '../domain/types';
import { durationMinutes, localDate, localTime } from '../domain/validation';
import { calendarDatesForPlanning, TaskDateIndex } from './TaskDateIndex';

export interface TaskIndexOptions {
  readonly statusCatalog: StatusCatalog;
  readonly dailyNoteFormat: string;
  readonly globalTaskFilter?: string;
}

type Listener = (event: TaskIndexEvent) => void;

const TAG_RE = /#[\w/-]+/gu;

function momentToRegex(format: string): RegExp {
  const escaped = format
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

function asLocalDate(value: string | undefined): LocalDate | undefined {
  if (value === undefined) return undefined;
  try {
    return localDate(value);
  } catch {
    return undefined;
  }
}

function asLocalTime(value: string | undefined): LocalTime | undefined {
  if (value === undefined) return undefined;
  try {
    return localTime(value);
  } catch {
    return undefined;
  }
}

function asDuration(value: number | undefined): DurationMinutes | undefined {
  if (value === undefined) return undefined;
  try {
    return durationMinutes(value);
  } catch {
    return undefined;
  }
}

function taskPlanning(task: {
  readonly due?: string;
  readonly scheduled?: string;
  readonly start?: string;
  readonly completion?: string;
  readonly cancelledDate?: string;
  readonly time?: string;
  readonly duration?: number;
}): TaskPlanning {
  const due = asLocalDate(task.due);
  const scheduled = asLocalDate(task.scheduled);
  const start = asLocalDate(task.start);
  const completion = asLocalDate(task.completion);
  const cancelled = asLocalDate(task.cancelledDate);
  const time = asLocalTime(task.time);
  const duration = asDuration(task.duration);
  return {
    ...(due && { due }),
    ...(scheduled && { scheduled }),
    ...(start && { start }),
    ...(completion && { completion }),
    ...(cancelled && { cancelled }),
    ...(time && { time }),
    ...(duration && { duration }),
  };
}

function subtaskPlanning(task: SubTask): SubtaskPlanning {
  const due = asLocalDate(task.due);
  const scheduled = asLocalDate(task.scheduled);
  const start = asLocalDate(task.start);
  const time = asLocalTime(task.time);
  return {
    ...(due && { due }),
    ...(scheduled && { scheduled }),
    ...(start && { start }),
    ...(time && { time }),
  };
}

function tagsIn(markdown: string): readonly string[] {
  return [...markdown.matchAll(TAG_RE)].map((match) => match[0]);
}

function revisionOf(block: string): string {
  // JSON string encoding is one-to-one, so equality confirms exact source rather than a hash.
  return `block:${JSON.stringify(block)}`;
}

/** Temporary legacy-presentation adapter support; revision remains opaque to public consumers. */
export function legacyBlockRangeOf(
  task: Pick<TaskSnapshot, 'ref' | 'source'>,
): { from: number; to: number } | undefined {
  if (!task.ref.revision.startsWith('block:')) return undefined;
  try {
    const block = JSON.parse(task.ref.revision.slice('block:'.length)) as unknown;
    if (typeof block !== 'string') return undefined;
    const lineCount = block.split('\n').length;
    return lineCount > 1
      ? { from: task.source.line + 1, to: task.source.line + lineCount - 1 }
      : undefined;
  } catch {
    return undefined;
  }
}

function cloneTaskRef(ref: TaskRef): TaskRef {
  return { ...ref };
}

function cloneNodeRef(ref: TaskNodeRef): TaskNodeRef {
  if (ref.type === 'task') return { type: 'task', ref: cloneTaskRef(ref.ref) };
  return {
    type: 'subtask',
    ref: {
      ...ref.ref,
      parent: cloneNodeRef(ref.ref.parent),
    },
  };
}

function cloneComment(comment: TaskCommentSnapshot): TaskCommentSnapshot {
  return {
    ...comment,
    ref: { ...comment.ref, parent: cloneNodeRef(comment.ref.parent) },
  };
}

function cloneSubtask(task: SubtaskSnapshot): SubtaskSnapshot {
  return {
    ...task,
    ref: { ...task.ref, parent: cloneNodeRef(task.ref.parent) },
    planning: { ...task.planning },
    tags: [...task.tags],
    subtasks: task.subtasks.map(cloneSubtask),
    comments: task.comments.map(cloneComment),
  };
}

function cloneSnapshot(task: TaskSnapshot): TaskSnapshot {
  return {
    ...task,
    ref: cloneTaskRef(task.ref),
    planning: { ...task.planning },
    tags: [...task.tags],
    subtasks: task.subtasks.map(cloneSubtask),
    comments: task.comments.map(cloneComment),
    source: { ...task.source },
    presentation: { ...task.presentation },
  };
}

function cloneCandidate(task: TaskSnapshot): TaskResolutionCandidate {
  const root = cloneSnapshot(task);
  return {
    root,
    target: { type: 'task', ref: cloneTaskRef(root.ref) },
  };
}

function stableTaskOrder(left: TaskSnapshot, right: TaskSnapshot): number {
  return (
    left.source.filePath.localeCompare(right.source.filePath) ||
    left.source.line - right.source.line
  );
}

function immutableEvent(event: TaskIndexEvent): TaskIndexEvent {
  if (event.type === 'changed') {
    return Object.freeze({ type: 'changed', files: Object.freeze([...event.files]) });
  }
  return Object.freeze({ ...event });
}

function blockFor(lines: readonly string[], line: number, rangeTo: number | undefined): string {
  return lines.slice(line, (rangeTo ?? line) + 1).join('\n');
}

function cacheWithContentFallback(data: string, cache: CachedMetadata): CachedMetadata {
  const sourceHasTask = data.split('\n').some((line) => /^[\s>]*- \[(.)\]/u.test(line));
  if (
    cache.listItems !== undefined &&
    (cache.listItems.some((item) => item.task !== undefined) || !sourceHasTask)
  ) {
    return cache;
  }
  const listItems = data.split('\n').flatMap((line, lineNumber) => {
    const match = /^[\s>]*- \[(.)\]/u.exec(line);
    if (!match) return [];
    return [
      {
        task: match[1] ?? ' ',
        parent: -1,
        position: {
          start: { line: lineNumber, col: 0, offset: 0 },
          end: { line: lineNumber, col: line.length, offset: line.length },
        },
      },
    ];
  });
  return { ...cache, listItems };
}

function commentSnapshot(
  comment: TaskComment,
  parent: TaskNodeRef,
  parentLine: number,
  lines: readonly string[],
): TaskCommentSnapshot {
  const date = asLocalDate(comment.date);
  const ref: CommentRef = {
    parent,
    relativeLine: comment.line - parentLine,
    originalMarkdown: lines[comment.line] ?? '',
  };
  return { ref, ...(date && { date }), text: comment.text };
}

function subtaskSnapshot(
  task: SubTask,
  parent: TaskNodeRef,
  parentLine: number,
  lines: readonly string[],
): SubtaskSnapshot {
  const ref = {
    parent,
    relativeLine: task.line - parentLine,
    originalBlock: blockFor(lines, task.line, task.subtaskRange?.to),
  };
  const node: TaskNodeRef = { type: 'subtask', ref };
  return {
    ref,
    title: task.text,
    markdownTitle: task.markdownText,
    status: task.status,
    statusSymbol: task.statusSymbol,
    priority: task.priority,
    planning: subtaskPlanning(task),
    tags: tagsIn(task.rawText),
    ...(task.recurrence !== undefined && { recurrence: task.recurrence }),
    subtasks: (task.subtasks ?? []).map((child) => subtaskSnapshot(child, node, task.line, lines)),
    comments: (task.comments ?? []).map((comment) =>
      commentSnapshot(comment, node, task.line, lines),
    ),
    ...(task.description !== undefined && { description: task.description }),
  };
}

function relocateSubtask(task: SubtaskSnapshot, parent: TaskNodeRef): SubtaskSnapshot {
  const ref = { ...task.ref, parent };
  const node: TaskNodeRef = { type: 'subtask', ref };
  return {
    ...task,
    ref,
    subtasks: task.subtasks.map((child) => relocateSubtask(child, node)),
    comments: task.comments.map((comment) => ({
      ...comment,
      ref: { ...comment.ref, parent: node },
    })),
  };
}

function relocateSnapshot(task: TaskSnapshot, filePath: string): TaskSnapshot {
  const ref = { ...task.ref, filePath };
  const node: TaskNodeRef = { type: 'task', ref };
  return {
    ...task,
    ref,
    source: { ...task.source, filePath },
    subtasks: task.subtasks.map((child) => relocateSubtask(child, node)),
    comments: task.comments.map((comment) => ({
      ...comment,
      ref: { ...comment.ref, parent: node },
    })),
  };
}

export class TaskIndex implements TaskQueryApi {
  private readonly taskMap = new Map<string, readonly TaskSnapshot[]>();
  private readonly dateIndex = new TaskDateIndex<TaskSnapshot>((task) =>
    calendarDatesForPlanning(task.planning),
  );
  private listeners: Listener[] = [];
  private readonly pendingFiles = new Set<string>();
  private readonly changeVersions = new Map<string, number>();
  private flushScheduled = false;
  private metadataCacheRefs: EventRef[] = [];
  private vaultRefs: EventRef[] = [];
  private initialized = false;
  private destroyed = false;
  private statusCatalog: StatusCatalog;

  constructor(
    private readonly app: App,
    private readonly options: TaskIndexOptions,
  ) {
    this.statusCatalog = options.statusCatalog;
  }

  setStatusCatalog(statusCatalog: StatusCatalog): void {
    this.statusCatalog = statusCatalog;
  }

  async initialize(): Promise<void> {
    if (this.initialized || this.destroyed) return;
    const files = [...this.app.vault.getMarkdownFiles()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const chunkSize = 50;
    for (let index = 0; index < files.length; index += chunkSize) {
      await Promise.all(files.slice(index, index + chunkSize).map((file) => this.loadFile(file)));
      if (index + chunkSize < files.length) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }
    if (this.destroyed) return;
    this.initialized = true;
    this.registerEvents();
    this.publish({ type: 'initialized' });
  }

  list(query?: TaskQuery): readonly TaskSnapshot[] {
    let tasks: readonly TaskSnapshot[];
    if (
      query?.filePath &&
      query.folder === undefined &&
      query.tag === undefined &&
      query.statuses === undefined &&
      query.dateRange === undefined
    ) {
      tasks = this.taskMap.get(query.filePath) ?? [];
    } else {
      tasks = [...this.taskMap.values()].flat();
    }
    let filtered = tasks;
    if (query?.filePath)
      filtered = filtered.filter((task) => task.source.filePath === query.filePath);
    if (query?.folder)
      filtered = filtered.filter((task) => task.source.filePath.startsWith(query.folder!));
    if (query?.tag)
      filtered = filtered.filter((task) => task.source.originalMarkdown.includes(query.tag!));
    if (query?.statuses?.length) {
      filtered = filtered.filter((task) => query.statuses!.includes(task.status));
    }
    if (query?.dateRange) {
      const { from, to } = query.dateRange;
      filtered = filtered.filter((task) => {
        const date =
          task.planning.due ??
          task.planning.scheduled ??
          task.planning.start ??
          task.presentation.dailyNoteDate;
        return date !== undefined && date >= from && date <= to;
      });
    }
    return [...filtered].sort(stableTaskOrder).map(cloneSnapshot);
  }

  forCalendarDates(dates: readonly LocalDate[]): readonly TaskSnapshot[] {
    const seen = new Set<TaskSnapshot>();
    for (const date of dates) {
      for (const task of this.dateIndex.get(date)) seen.add(task);
    }
    return [...seen].sort(stableTaskOrder).map(cloneSnapshot);
  }

  resolve(ref: TaskRef): TaskResolution {
    const tasks = this.taskMap.get(ref.filePath) ?? [];
    const current = tasks.find((task) => task.source.line === ref.line);
    if (current?.ref.revision === ref.revision) {
      return { type: 'exact', task: cloneSnapshot(current) };
    }
    const matches = tasks.filter((task) => task.ref.revision === ref.revision);
    if (matches.length === 1) return { type: 'exact', task: cloneSnapshot(matches[0]!) };
    if (matches.length > 1) {
      return { type: 'ambiguous', candidates: matches.map(cloneCandidate) };
    }
    if (current) return { type: 'conflict', current: cloneSnapshot(current) };
    return { type: 'not-found', ref: cloneTaskRef(ref) };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const ref of this.metadataCacheRefs) this.app.metadataCache.offref(ref);
    for (const ref of this.vaultRefs) this.app.vault.offref(ref);
    this.metadataCacheRefs = [];
    this.vaultRefs = [];
    this.listeners = [];
    this.pendingFiles.clear();
    this.changeVersions.clear();
    this.taskMap.clear();
    this.dateIndex.clear();
  }

  private async loadFile(file: TFile): Promise<void> {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.listItems?.some((item) => item.task !== undefined)) {
        if (this.destroyed) return;
        this.replaceFile(file.path, []);
        return;
      }
      const content = await this.app.vault.cachedRead(file);
      if (this.destroyed) return;
      this.replaceFile(file.path, this.parseFile(file.path, content, cache));
    } catch {
      if (this.destroyed) return;
      this.replaceFile(file.path, []);
    }
  }

  private parseFile(
    filePath: string,
    content: string,
    cache: CachedMetadata,
  ): readonly TaskSnapshot[] {
    if (!cache.listItems) return [];
    const lines = content.split('\n');
    const filename = filePath.replace(/^.*\//u, '').replace(/\.[^.]*$/u, '');
    const dailyNoteDate = momentToRegex(this.options.dailyNoteFormat).test(filename)
      ? asLocalDate(window.moment(filename, this.options.dailyNoteFormat).format('YYYY-MM-DD'))
      : undefined;
    const frontmatter = cache.frontmatter;
    const noteColor = typeof frontmatter?.['color'] === 'string' ? frontmatter['color'] : undefined;
    const noteTextColor =
      typeof frontmatter?.['textColor'] === 'string' ? frontmatter['textColor'] : undefined;
    const noteIcon = typeof frontmatter?.['icon'] === 'string' ? frontmatter['icon'] : undefined;
    const itemByLine = new Map<number, (typeof cache.listItems)[number]>();
    for (const item of cache.listItems) itemByLine.set(item.position.start.line, item);
    const hasTaskAncestor = (item: (typeof cache.listItems)[number]): boolean => {
      let parentLine = item.parent;
      const seen = new Set<number>();
      while (parentLine >= 0 && !seen.has(parentLine)) {
        if (parentLine === item.position.start.line) break;
        seen.add(parentLine);
        const parent = itemByLine.get(parentLine);
        if (!parent) break;
        if (parent.task !== undefined) return true;
        parentLine = parent.parent;
      }
      return false;
    };

    const snapshots: TaskSnapshot[] = [];
    for (const item of cache.listItems) {
      if (item.task === undefined || hasTaskAncestor(item)) continue;
      const line = item.position.start.line;
      const originalMarkdown = lines[line] ?? '';
      const task = parseTask(originalMarkdown, {
        filePath,
        line,
        ...(dailyNoteDate && { dailyNoteDate }),
        ...(this.options.globalTaskFilter && { globalTaskFilter: this.options.globalTaskFilter }),
        statusCatalog: this.statusCatalog,
      });
      if (!task) continue;
      const subitems = parseSubItems(lines, line, filePath, this.statusCatalog);
      const exactBlock = blockFor(lines, line, subitems.subtaskRange?.to);
      const ref: TaskRef = { filePath, line, revision: revisionOf(exactBlock) };
      const node: TaskNodeRef = { type: 'task', ref };
      const presentation = {
        linkCount: countLinksIn([
          task.markdownText,
          subitems.description,
          ...subitems.comments.map((comment) => comment.text),
        ]),
        ...(dailyNoteDate && { dailyNoteDate }),
        ...(noteColor && { noteColor }),
        ...(noteTextColor && { noteTextColor }),
        ...(noteIcon && { noteIcon }),
      };
      snapshots.push({
        ref,
        title: task.text,
        markdownTitle: task.markdownText,
        status: task.status,
        statusSymbol: task.statusSymbol,
        priority: task.priority,
        planning: taskPlanning(task),
        tags: tagsIn(originalMarkdown),
        ...(task.recurrence !== undefined && { recurrence: task.recurrence }),
        subtasks: subitems.subtasks.map((subtask) => subtaskSnapshot(subtask, node, line, lines)),
        comments: subitems.comments.map((comment) => commentSnapshot(comment, node, line, lines)),
        ...(subitems.description && { description: subitems.description }),
        source: { filePath, line, originalMarkdown },
        presentation,
      });
    }
    return snapshots.sort(stableTaskOrder);
  }

  private replaceFile(filePath: string, tasks: readonly TaskSnapshot[]): void {
    if (tasks.length > 0) this.taskMap.set(filePath, tasks);
    else this.taskMap.delete(filePath);
    this.dateIndex.updateFile(filePath, tasks);
  }

  private registerEvents(): void {
    this.metadataCacheRefs.push(
      this.app.metadataCache.on('changed', (file: TFile, data: string, cache: CachedMetadata) => {
        if (file.extension !== 'md' || this.destroyed) return;
        this.changeVersions.set(file.path, (this.changeVersions.get(file.path) ?? 0) + 1);
        if (!this.app.vault.getAbstractFileByPath(file.path)) {
          this.replaceFile(file.path, []);
        } else {
          this.replaceFile(
            file.path,
            this.parseFile(file.path, data, cacheWithContentFallback(data, cache)),
          );
        }
        this.queueChanged(file.path);
      }),
    );
    this.vaultRefs.push(
      this.app.vault.on('create', (file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== 'md' || this.destroyed) return;
        const cache = this.app.metadataCache.getFileCache(file);
        // Obsidian normally follows create with a metadata `changed` event. Avoid an
        // empty-cache create read racing and overwriting that newer parsed snapshot.
        if (!cache?.listItems?.some((item) => item.task !== undefined)) return;
        const observedVersion = this.changeVersions.get(file.path) ?? 0;
        void this.app.vault
          .cachedRead(file)
          .then((content) => {
            if (this.destroyed || (this.changeVersions.get(file.path) ?? 0) !== observedVersion) {
              return;
            }
            this.replaceFile(file.path, this.parseFile(file.path, content, cache));
            this.queueChanged(file.path);
          })
          .catch(() => undefined);
      }),
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (!(file instanceof TFile) || file.extension !== 'md' || this.destroyed) return;
        const tasks = this.taskMap.get(oldPath) ?? [];
        this.replaceFile(oldPath, []);
        this.replaceFile(
          file.path,
          tasks.map((task) => relocateSnapshot(task, file.path)),
        );
        this.pendingFiles.delete(oldPath);
        this.publish({ type: 'renamed', oldPath, newPath: file.path });
      }),
      this.app.vault.on('delete', (file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== 'md' || this.destroyed) return;
        const existed = this.taskMap.has(file.path);
        this.replaceFile(file.path, []);
        this.pendingFiles.delete(file.path);
        if (existed) this.publish({ type: 'deleted', path: file.path });
      }),
    );
  }

  private queueChanged(filePath: string): void {
    if (this.destroyed) return;
    this.pendingFiles.add(filePath);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    void Promise.resolve().then(() => {
      this.flushScheduled = false;
      if (this.destroyed || this.pendingFiles.size === 0) return;
      const files = [...this.pendingFiles].sort((left, right) => left.localeCompare(right));
      this.pendingFiles.clear();
      this.publish({ type: 'changed', files });
    });
  }

  private publish(event: TaskIndexEvent): void {
    if (this.destroyed) return;
    const detached = immutableEvent(event);
    for (const listener of [...this.listeners]) listener(detached);
  }
}
