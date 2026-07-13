import { TFile, type App, type CachedMetadata, type EventRef, type TAbstractFile } from 'obsidian';
import { legacyTaskFromParsed } from '../../parser/legacyTaskProjection';
import { countLinksIn } from '../../parser/links';
import { parseSubItems } from '../../parser/SubItemParser';
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
import { TaskMarkdownCodec } from './markdown/TaskMarkdownCodec';
import { calendarDatesForPlanning, TaskDateIndex } from './TaskDateIndex';

export interface TaskIndexOptions {
  readonly statusCatalog: StatusCatalog;
  readonly dailyNoteFormat: string;
  readonly globalTaskFilter?: string;
}

type Listener = (event: TaskIndexEvent) => void;

interface FileLifecycle {
  path: string | undefined;
  generation: number;
}

interface FileObservation {
  readonly file: TFile;
  readonly path: string;
  readonly generation: number;
}

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

interface FallbackListItem {
  readonly task?: string;
  readonly parent: number;
  readonly position: {
    readonly start: { readonly line: number; readonly col: number; readonly offset: number };
    readonly end: { readonly line: number; readonly col: number; readonly offset: number };
  };
}

interface FallbackListAncestor {
  readonly line: number;
  readonly indent: number;
}

interface FallbackFence {
  readonly marker: '`' | '~';
  readonly length: number;
  readonly quoteDepth: number;
}

const FALLBACK_LIST_ITEM_RE = /^([\s>]*)(?:[-*+]|\d+[.)])\s+/u;
const FALLBACK_TASK_RE = /^[\s>]*- \[(.)\]/u;
const FALLBACK_FENCE_RE = /^[\s>]*(`{3,}|~{3,})/u;
const FALLBACK_PREFIX_RE = /^([\s>]*)/u;

function fallbackFenceState(
  line: string,
  quoteDepth: number,
  active: FallbackFence | undefined,
): { readonly active: FallbackFence | undefined; readonly skip: boolean } {
  const token = FALLBACK_FENCE_RE.exec(line)?.[1];
  if (active && quoteDepth >= active.quoteDepth) {
    const closes =
      quoteDepth === active.quoteDepth &&
      token?.[0] === active.marker &&
      token.length >= active.length;
    return { active: closes ? undefined : active, skip: true };
  }
  if (token === undefined) return { active: undefined, skip: false };
  const marker = token[0];
  return marker === '`' || marker === '~'
    ? { active: { marker, length: token.length, quoteDepth }, skip: true }
    : { active: undefined, skip: false };
}

function transitionFallbackQuoteDepth(
  quoteDepth: number,
  previousQuoteDepth: number | undefined,
  ancestorsByQuoteDepth: Map<number, FallbackListAncestor[]>,
): number {
  if (previousQuoteDepth !== undefined && previousQuoteDepth !== quoteDepth) {
    ancestorsByQuoteDepth.clear();
  }
  return quoteDepth;
}

function fallbackListItems(data: string): FallbackListItem[] {
  const lines = data.split('\n');
  const items: FallbackListItem[] = [];
  const ancestorsByQuoteDepth = new Map<number, FallbackListAncestor[]>();
  let offset = 0;
  let frontmatter = lines[0]?.trim() === '---';
  let fence: FallbackFence | undefined;
  let previousQuoteDepth: number | undefined;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber] ?? '';
    if (frontmatter) {
      if (lineNumber > 0 && line.trim() === '---') frontmatter = false;
      offset += line.length + 1;
      continue;
    }

    const leadingPrefix = FALLBACK_PREFIX_RE.exec(line)?.[1] ?? '';
    const quoteDepth = [...leadingPrefix].filter((character) => character === '>').length;
    const activeFence = fence;
    const nextFence = fallbackFenceState(line, quoteDepth, fence);
    fence = nextFence.active;
    if (nextFence.skip) {
      if (activeFence === undefined || quoteDepth <= activeFence.quoteDepth) {
        previousQuoteDepth = transitionFallbackQuoteDepth(
          quoteDepth,
          previousQuoteDepth,
          ancestorsByQuoteDepth,
        );
      }
      offset += line.length + 1;
      continue;
    }
    if (/^[\s>]*$/u.test(line)) {
      offset += line.length + 1;
      continue;
    }

    previousQuoteDepth = transitionFallbackQuoteDepth(
      quoteDepth,
      previousQuoteDepth,
      ancestorsByQuoteDepth,
    );

    const listMatch = FALLBACK_LIST_ITEM_RE.exec(line);
    if (!listMatch) {
      const indent = leadingPrefix.replace(/\t/gu, '    ').length;
      const ancestors = ancestorsByQuoteDepth.get(quoteDepth) ?? [];
      while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.indent >= indent) {
        ancestors.pop();
      }
      ancestorsByQuoteDepth.set(quoteDepth, ancestors);
      offset += line.length + 1;
      continue;
    }
    const prefix = listMatch[1] ?? '';
    const indent = prefix.replace(/\t/gu, '    ').length;
    const ancestors = ancestorsByQuoteDepth.get(quoteDepth) ?? [];
    while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.indent >= indent) {
      ancestors.pop();
    }
    const parent = ancestors[ancestors.length - 1]?.line ?? -(lineNumber + 1);
    const task = FALLBACK_TASK_RE.exec(line)?.[1];
    items.push({
      ...(task !== undefined && { task }),
      parent,
      position: {
        start: { line: lineNumber, col: prefix.length, offset },
        end: { line: lineNumber, col: line.length, offset: offset + line.length },
      },
    });
    ancestors.push({ line: lineNumber, indent });
    ancestorsByQuoteDepth.set(quoteDepth, ancestors);
    offset += line.length + 1;
  }
  return items;
}

function cacheWithContentFallback(
  data: string,
  cache: CachedMetadata | null | undefined,
): CachedMetadata {
  const fallbackItems = fallbackListItems(data);
  const sourceHasTask = fallbackItems.some((item) => item.task !== undefined);
  if (
    cache?.listItems !== undefined &&
    (cache.listItems.some((item) => item.task !== undefined) || !sourceHasTask)
  ) {
    return cache;
  }
  return { ...(cache ?? {}), listItems: fallbackItems };
}

function extensionOf(path: string): string {
  const name = path.replace(/^.*\//u, '');
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

function dailyNoteDateForPath(filePath: string, format: string): LocalDate | undefined {
  const filename = filePath.replace(/^.*\//u, '').replace(/\.[^.]*$/u, '');
  return momentToRegex(format).test(filename)
    ? asLocalDate(window.moment(filename, format).format('YYYY-MM-DD'))
    : undefined;
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

function relocateSnapshot(
  task: TaskSnapshot,
  filePath: string,
  dailyNoteDate: LocalDate | undefined,
): TaskSnapshot {
  const ref = { ...task.ref, filePath };
  const node: TaskNodeRef = { type: 'task', ref };
  const { linkCount, noteColor, noteTextColor, noteIcon } = task.presentation;
  return {
    ...task,
    ref,
    source: { ...task.source, filePath },
    subtasks: task.subtasks.map((child) => relocateSubtask(child, node)),
    comments: task.comments.map((comment) => ({
      ...comment,
      ref: { ...comment.ref, parent: node },
    })),
    presentation: {
      linkCount,
      ...(dailyNoteDate && { dailyNoteDate }),
      ...(noteColor && { noteColor }),
      ...(noteTextColor && { noteTextColor }),
      ...(noteIcon && { noteIcon }),
    },
  };
}

export class TaskIndex implements TaskQueryApi {
  private readonly taskMap = new Map<string, readonly TaskSnapshot[]>();
  private readonly dateIndex = new TaskDateIndex<TaskSnapshot>((task) =>
    calendarDatesForPlanning(task.planning),
  );
  private listeners: Listener[] = [];
  private readonly pendingFiles = new Set<string>();
  private fileLifecycles = new WeakMap<TFile, FileLifecycle>();
  private readonly pendingReads = new Set<Promise<void>>();
  private flushScheduled = false;
  private metadataCacheRefs: EventRef[] = [];
  private vaultRefs: EventRef[] = [];
  private initialization: Promise<void> | undefined;
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
    this.initialization ??= this.performInitialization();
    await this.initialization;
  }

  private async performInitialization(): Promise<void> {
    this.registerEvents();
    const files = [...this.app.vault.getMarkdownFiles()]
      .map((file) => ({ file, path: file.path }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const chunkSize = 50;
    for (let index = 0; index < files.length; index += chunkSize) {
      await Promise.all(
        files
          .slice(index, index + chunkSize)
          .map(({ file, path }) => this.loadFile(file, path, false)),
      );
      if (index + chunkSize < files.length) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }
    await this.drainPendingReads();
    if (this.destroyed) return;
    this.initialized = true;
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
    this.fileLifecycles = new WeakMap();
    this.pendingReads.clear();
    this.taskMap.clear();
    this.dateIndex.clear();
  }

  private async loadFile(
    file: TFile,
    path: string,
    forceContentFallback: boolean,
  ): Promise<boolean> {
    const observation = this.observe(file, path);
    if (!observation) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    if (!forceContentFallback && !cache?.listItems?.some((item) => item.task !== undefined)) {
      if (!this.isCurrent(observation)) return false;
      this.replaceFile(path, []);
      return true;
    }
    try {
      const content = await this.app.vault.cachedRead(file);
      if (!this.isCurrent(observation)) return false;
      this.replaceFile(
        path,
        this.parseFile(
          path,
          content,
          forceContentFallback ? cacheWithContentFallback(content, cache) : cache!,
        ),
      );
      return true;
    } catch {
      if (!this.isCurrent(observation)) return false;
      this.replaceFile(path, []);
      return true;
    }
  }

  private parseFile(
    filePath: string,
    content: string,
    cache: CachedMetadata,
  ): readonly TaskSnapshot[] {
    if (!cache.listItems) return [];
    const lines = content.split('\n');
    const dailyNoteDate = dailyNoteDateForPath(filePath, this.options.dailyNoteFormat);
    const codec = new TaskMarkdownCodec(this.statusCatalog);
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
      const parsed = codec.parseLine(originalMarkdown, { filePath, line });
      if (!parsed) continue;
      const parseContext = {
        filePath,
        line,
        ...(dailyNoteDate && { dailyNoteDate }),
        ...(this.options.globalTaskFilter && { globalTaskFilter: this.options.globalTaskFilter }),
        statusCatalog: this.statusCatalog,
      };
      const task = legacyTaskFromParsed(parsed, parseContext, (symbol) =>
        codec.statusForSymbol(symbol),
      );
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
        const path = file.path;
        if (
          file.extension !== 'md' ||
          this.destroyed ||
          this.app.vault.getAbstractFileByPath(path) !== file
        ) {
          return;
        }
        this.advance(file, path);
        this.replaceFile(path, this.parseFile(path, data, cacheWithContentFallback(data, cache)));
        this.queueChanged(path);
      }),
    );
    this.vaultRefs.push(
      this.app.vault.on('create', (file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== 'md' || this.destroyed) return;
        const path = file.path;
        if (this.app.vault.getAbstractFileByPath(path) !== file) return;
        this.advance(file, path);
        const read = this.loadFile(file, path, true).then((committed) => {
          if (committed) this.queueChanged(path);
        });
        this.trackRead(read);
      }),
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (!(file instanceof TFile) || this.destroyed) return;
        const newPath = file.path;
        const wasMarkdown = extensionOf(oldPath) === 'md';
        const isMarkdown = file.extension === 'md';
        if (
          (!wasMarkdown && !isMarkdown) ||
          this.app.vault.getAbstractFileByPath(newPath) !== file
        ) {
          return;
        }
        const tasks = this.taskMap.get(oldPath) ?? [];
        this.advance(file, isMarkdown ? newPath : undefined);
        this.replaceFile(oldPath, []);
        if (newPath !== oldPath) this.replaceFile(newPath, []);
        this.pendingFiles.delete(oldPath);
        this.pendingFiles.delete(newPath);

        if (wasMarkdown && isMarkdown) {
          if (tasks.length > 0) {
            const dailyNoteDate = dailyNoteDateForPath(newPath, this.options.dailyNoteFormat);
            this.replaceFile(
              newPath,
              tasks.map((task) => relocateSnapshot(task, newPath, dailyNoteDate)),
            );
            this.publish({ type: 'renamed', oldPath, newPath });
          } else {
            const read = this.loadFile(file, newPath, true).then((committed) => {
              if (committed || this.isFileAt(file, newPath)) {
                this.publish({ type: 'renamed', oldPath, newPath });
              }
            });
            this.trackRead(read);
          }
          return;
        }

        if (wasMarkdown) {
          this.publish({ type: 'renamed', oldPath, newPath });
          return;
        }

        const read = this.loadFile(file, newPath, true).then((committed) => {
          if (committed || this.isFileAt(file, newPath)) {
            this.publish({ type: 'renamed', oldPath, newPath });
          }
        });
        this.trackRead(read);
      }),
      this.app.vault.on('delete', (file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== 'md' || this.destroyed) return;
        const path = file.path;
        const existed = this.taskMap.has(path);
        this.advance(file, undefined);
        this.replaceFile(path, []);
        this.pendingFiles.delete(path);
        if (existed) this.publish({ type: 'deleted', path });
      }),
    );
  }

  private observe(file: TFile, path: string): FileObservation | undefined {
    if (this.destroyed || this.app.vault.getAbstractFileByPath(path) !== file) return undefined;
    const existing = this.fileLifecycles.get(file);
    if (existing && existing.path !== path) return undefined;
    const lifecycle = existing ?? { path, generation: 0 };
    if (!existing) this.fileLifecycles.set(file, lifecycle);
    return { file, path, generation: lifecycle.generation };
  }

  private advance(file: TFile, path: string | undefined): void {
    const lifecycle = this.fileLifecycles.get(file);
    this.fileLifecycles.set(file, {
      path,
      generation: (lifecycle?.generation ?? 0) + 1,
    });
  }

  private isCurrent(observation: FileObservation): boolean {
    const lifecycle = this.fileLifecycles.get(observation.file);
    return (
      !this.destroyed &&
      lifecycle?.path === observation.path &&
      lifecycle.generation === observation.generation &&
      observation.file.extension === 'md' &&
      this.app.vault.getAbstractFileByPath(observation.path) === observation.file
    );
  }

  private isFileAt(file: TFile, path: string): boolean {
    const lifecycle = this.fileLifecycles.get(file);
    return (
      !this.destroyed &&
      lifecycle?.path === path &&
      file.extension === 'md' &&
      this.app.vault.getAbstractFileByPath(path) === file
    );
  }

  private trackRead(read: Promise<void>): void {
    this.pendingReads.add(read);
    void read.finally(() => this.pendingReads.delete(read));
  }

  private async drainPendingReads(): Promise<void> {
    while (!this.destroyed && this.pendingReads.size > 0) {
      await Promise.all([...this.pendingReads]);
    }
  }

  private queueChanged(filePath: string): void {
    if (this.destroyed || !this.initialized) return;
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
    if (this.destroyed || (!this.initialized && event.type !== 'initialized')) return;
    const detached = immutableEvent(event);
    for (const listener of [...this.listeners]) listener(detached);
  }
}
