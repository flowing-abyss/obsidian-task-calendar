// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { App as ObsidianApp, Platform, TFile, type CachedMetadata } from 'obsidian';
import { afterEach, beforeEach, vi } from 'vitest';
import type { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import { LeftPanel } from '../src/panels/LeftPanel';
import type { SubTask, Task, TaskComment } from '../src/parser/types';
import type { ProjectManager } from '../src/projects/ProjectManager';
import type { ProjectStore } from '../src/projects/ProjectStore';
import { DailyNoteResolver } from '../src/resolvers/DailyNoteResolver';
import { buildDefaultTaskStatuses, DEFAULT_VIEW_CONFIG } from '../src/settings/defaults';
import { toStatusRules } from '../src/settings/statusCatalogAdapter';
import type { CalendarSettings, ResolvedConfig } from '../src/settings/types';
import { StatusRegistry } from '../src/status/StatusRegistry';
import type { TagManager } from '../src/tags/TagManager';
import type {
  LocalDate,
  SubtaskSnapshot,
  TaskApplicationApi,
  TaskCommentSnapshot,
  TaskIndexEvent,
  TaskNodeRef,
  TaskQueryApi,
  TaskSnapshot,
} from '../src/tasks';
import { TaskApplicationService } from '../src/tasks/application/TaskApplicationService';
import { StatusCatalog } from '../src/tasks/domain/StatusCatalog';
import { localDate } from '../src/tasks/domain/validation';
import { TaskIndex } from '../src/tasks/infrastructure/TaskIndex';
import { TaskBlockEditor } from '../src/tasks/infrastructure/markdown/TaskBlockEditor';
import { TaskLocator } from '../src/tasks/infrastructure/markdown/TaskLocator';
import { TaskMarkdownCodec } from '../src/tasks/infrastructure/markdown/TaskMarkdownCodec';
import { ObsidianTaskDestinationProvider } from '../src/tasks/infrastructure/obsidian/ObsidianTaskDestinationProvider';
import { ObsidianTaskRepository } from '../src/tasks/infrastructure/obsidian/ObsidianTaskRepository';

export function taskSnapshotOf(value: Task): TaskSnapshot {
  const explicitTags = (value as Task & { readonly tags?: readonly string[] }).tags;
  const tags = explicitTags
    ? [...explicitTags]
    : [...value.rawText.matchAll(/#[\w/-]+/gu)].map((match) => match[0]);
  return {
    ref: {
      filePath: value.filePath,
      line: value.line,
      revision: `test:${value.filePath}:${value.line}:${value.rawText}`,
    },
    title: value.text,
    markdownTitle: value.markdownText,
    status: value.status,
    statusSymbol: value.statusSymbol,
    priority: value.priority,
    planning: {
      ...(value.due && { due: value.due as LocalDate }),
      ...(value.scheduled && { scheduled: value.scheduled as LocalDate }),
      ...(value.start && { start: value.start as LocalDate }),
      ...(value.completion && { completion: value.completion as LocalDate }),
      ...(value.cancelledDate && { cancelled: value.cancelledDate as LocalDate }),
      ...(value.time && { time: value.time as TaskSnapshot['planning']['time'] }),
      ...(value.duration && { duration: value.duration as TaskSnapshot['planning']['duration'] }),
    },
    tags,
    recurrence: value.recurrence,
    subtasks: [],
    comments: [],
    description: value.description,
    source: {
      filePath: value.filePath,
      line: value.line,
      originalMarkdown: value.rawText,
      originalBlock: value.rawText,
    },
    presentation: {
      linkCount: value.linkCount ?? 0,
      ...(value.dailyNoteDate && { dailyNoteDate: value.dailyNoteDate as LocalDate }),
      ...(value.noteColor && { noteColor: value.noteColor }),
      ...(value.noteTextColor && { noteTextColor: value.noteTextColor }),
      ...(value.noteIcon && { noteIcon: value.noteIcon }),
    },
  };
}

export function queryApiForTasks(
  getTasks: () => readonly Task[],
  onSubscribe?: (listener: (event: TaskIndexEvent) => void) => () => void,
): TaskQueryApi {
  return {
    list: (query) =>
      getTasks()
        .filter((task) => query?.filePath === undefined || task.filePath === query.filePath)
        .filter((task) => query?.tag === undefined || taskSnapshotOf(task).tags.includes(query.tag))
        .filter((task) => query?.statuses === undefined || query.statuses.includes(task.status))
        .map(taskSnapshotOf),
    forCalendarDates: (dates) => {
      const wanted = new Set<string>(dates);
      return getTasks()
        .filter((task) =>
          [task.due, task.scheduled, task.start, task.dailyNoteDate].some(
            (date) => date !== undefined && wanted.has(date),
          ),
        )
        .map(taskSnapshotOf);
    },
    resolve: (ref) => {
      const found = getTasks().find(
        (task) => task.filePath === ref.filePath && task.line === ref.line,
      );
      return found ? { type: 'exact', task: taskSnapshotOf(found) } : { type: 'not-found', ref };
    },
    subscribe: onSubscribe ?? (() => () => {}),
  };
}

export interface TestTaskHarness extends TaskApplicationApi {
  readonly taskQueries: TaskQueryApi;
  readonly statusRegistry: StatusRegistry;
  readonly toggleTask: ReturnType<typeof vi.fn>;
  readonly setPriority: ReturnType<typeof vi.fn>;
  readonly setTaskStatus: ReturnType<typeof vi.fn>;
}

export function makeCenterPanelForTest(
  state: AppState,
  taskHarness: TestTaskHarness,
  app: ObsidianApp,
  settings: CalendarSettings,
  _tagManager: TagManager,
  onSaveSettings: () => Promise<void> = async () => {},
  projectStore: ProjectStore | null = null,
  projectManager: ProjectManager | null = null,
  tasks?: TaskApplicationApi,
): CenterPanel {
  const application = tasks ?? taskHarness;
  return new CenterPanel(
    state,
    app,
    settings,
    taskHarness.queries,
    taskHarness.statusRegistry,
    onSaveSettings,
    projectStore,
    projectManager,
    application,
  );
}

export function makeLeftPanelForTest(
  state: AppState,
  taskHarness: TestTaskHarness,
  settings: CalendarSettings,
  tagManager: TagManager,
  app: ObsidianApp,
  onSaveSettings: () => Promise<void> = async () => {},
  projectStore: ProjectStore | null = null,
  projectManager: ProjectManager | null = null,
  tasks?: TaskApplicationApi,
): LeftPanel {
  const application = tasks ?? taskHarness;
  return new LeftPanel(
    state,
    settings,
    tagManager,
    app,
    taskHarness.queries,
    application,
    onSaveSettings,
    projectStore,
    projectManager,
  );
}

/** Canonical semantic status catalog for parser/codec compatibility tests. */
export function canonicalStatusCatalog(): StatusCatalog {
  return new StatusCatalog(toStatusRules(buildDefaultTaskStatuses()));
}

export function testStatusRegistry(): StatusRegistry {
  return new StatusRegistry(buildDefaultTaskStatuses());
}

/** Install real moment as window.moment for date-aware tests. Idempotent; restores in afterEach. */
export function useRealMoment(): void {
  let prev: unknown;
  beforeEach(() => {
    prev = (window as unknown as { moment?: unknown }).moment;
    (window as unknown as { moment?: unknown }).moment = moment;
  });
  afterEach(() => {
    (window as unknown as { moment?: unknown }).moment = prev;
  });
}

/** Toggle Platform.isMobile for a block; restores previous value in afterEach. */
export function withMobile(value: boolean): void {
  let prev: boolean;
  beforeEach(() => {
    prev = Platform.isMobile;
    (Platform as unknown as { isMobile: boolean }).isMobile = value;
  });
  afterEach(() => {
    (Platform as unknown as { isMobile: boolean }).isMobile = prev;
  });
}

export type TaskFixture = Task & TaskSnapshot;
export type SubtaskFixture = SubTask & SubtaskSnapshot;
export type TaskCommentFixture = TaskComment & TaskCommentSnapshot;

function commentFixture(
  comment: TaskComment | TaskCommentSnapshot,
  parent: TaskNodeRef,
  parentLine: number,
): TaskCommentFixture {
  if ('ref' in comment && !('line' in comment)) return comment as TaskCommentFixture;
  const legacy = comment as TaskComment;
  return {
    ...legacy,
    ref: {
      parent,
      relativeLine: legacy.line - parentLine,
      originalMarkdown: legacy.text,
    },
    ...(legacy.date && { date: legacy.date as LocalDate }),
  } as TaskCommentFixture;
}

function subtaskFixture(
  subtask: SubTask | SubtaskSnapshot,
  parent: TaskNodeRef,
  parentLine: number,
): SubtaskFixture {
  if ('ref' in subtask && !('filePath' in subtask)) return subtask as SubtaskFixture;
  const legacy = subtask as SubTask & { readonly ref?: SubtaskSnapshot['ref'] };
  const ref = legacy.ref
    ? legacy.ref
    : {
        parent,
        relativeLine: legacy.line - parentLine,
        originalBlock: legacy.rawText,
      };
  const nodeRef: TaskNodeRef = { type: 'subtask', ref };
  const subtasks = (legacy.subtasks ?? []).map((child) =>
    subtaskFixture(child, nodeRef, legacy.line),
  );
  const comments = (legacy.comments ?? []).map((comment) =>
    commentFixture(comment, nodeRef, legacy.line),
  );
  return {
    ...legacy,
    ref,
    title: legacy.text,
    markdownTitle: legacy.markdownText,
    planning: {
      ...(legacy.due && { due: legacy.due as LocalDate }),
      ...(legacy.scheduled && { scheduled: legacy.scheduled as LocalDate }),
      ...(legacy.start && { start: legacy.start as LocalDate }),
      ...(legacy.time && { time: legacy.time as SubtaskSnapshot['planning']['time'] }),
    },
    tags: legacy.tags ?? [],
    subtasks,
    comments,
  } as SubtaskFixture;
}

/** Build one detached snapshot with legacy fixture fields for still-unmigrated parser tests. */
export function task(
  overrides: Partial<Task> | Partial<TaskSnapshot> | Record<string, unknown> = {},
): TaskFixture {
  const legacyOverrides = overrides as Partial<Task>;
  const snapshotOverrides = overrides as Partial<TaskSnapshot>;
  const text = legacyOverrides.text ?? snapshotOverrides.title ?? 't';
  const rawText = legacyOverrides.rawText ?? '- [ ] t';
  const legacy: Task = {
    filePath: 'f.md',
    line: 0,
    rawText,
    tags: rawText.match(/#[\w/-]+/gu) ?? [],
    text,
    markdownText: text,
    status: 'open',
    statusSymbol: ' ',
    priority: 'D',
    ...legacyOverrides,
  };
  const snapshot = taskSnapshotOf(legacy);
  const rootRef: TaskNodeRef = { type: 'task', ref: snapshot.ref };
  const subtasks = (legacy.subtasks ?? []).map((subtask) =>
    subtaskFixture(subtask, rootRef, legacy.line),
  );
  const comments = (legacy.comments ?? []).map((comment) =>
    commentFixture(comment, rootRef, legacy.line),
  );
  return {
    ...legacy,
    ...snapshot,
    ...snapshotOverrides,
    subtasks: subtasks as TaskFixture['subtasks'],
    comments: comments as TaskFixture['comments'],
  } as TaskFixture;
}

/** Create a fresh App with pre-populated files and flushed async metadata parsing. */
export async function createAppWithFiles(files: Record<string, string>): Promise<ObsidianApp> {
  const app = (
    ObsidianApp as unknown as {
      createConfigured__: (params: { files: Record<string, string> }) => ObsidianApp;
    }
  ).createConfigured__({ files });
  // Flush the mock's async parseFileMetadata for each file
  await Promise.all(app.vault.getMarkdownFiles().map((f) => app.vault.cachedRead(f)));
  await flushMicrotasks();
  return app;
}

/** Wait for the mock's async metadata parsing to settle. */
export async function flushMicrotasks(ms = 10): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Seed a file's metadata cache with task listItems + optional frontmatter (parent=-1 for root items). */
export function seedTaskCache(
  app: ObsidianApp,
  path: string,
  items: Array<{ task: string; parent: number; line: number }>,
  frontmatter?: Record<string, unknown>,
): void {
  const cache = {
    listItems: items.map((i) => ({
      task: i.task,
      parent: i.parent,
      // Only `start.line` is read by the task index; col/offset complete the cache shape.
      position: {
        start: { line: i.line, col: 0, offset: 0 },
        end: { line: i.line, col: 80, offset: 80 },
      },
    })),
    ...(frontmatter ? { frontmatter } : {}),
  };
  (
    app.metadataCache as unknown as { setCache__: (path: string, cache: unknown) => void }
  ).setCache__(path, cache);
}

/**
 * Capture the `changed` callback the task index registers on metadataCache, so tests can invoke it
 * directly with a crafted (TFile, content, CachedMetadata). Needed because setCache__ fires
 * `changed` with zero args (which would crash the handler). Call before index initialization
 * so registerEvents's metadataCache.on('changed', cb) is captured.
 */
export function captureChangedCallback(
  app: ObsidianApp,
): (file: TFile, content: string, cache: CachedMetadata) => void {
  let captured: ((file: TFile, content: string, cache: CachedMetadata) => void) | null = null;
  const origOn = app.metadataCache.on.bind(app.metadataCache) as (
    name: string,
    cb: (...args: unknown[]) => void,
  ) => unknown;
  app.metadataCache.on = ((name: string, cb: (...args: unknown[]) => void) => {
    if (name === 'changed') {
      captured = cb;
    }
    return origOn(name, cb);
  }) as typeof app.metadataCache.on;
  return (file: TFile, content: string, cache: CachedMetadata) => {
    if (!captured) throw new Error('captureChangedCallback: no changed handler registered');
    captured(file, content, cache);
  };
}

/** Build a full ResolvedConfig with sane defaults; overrides win. */
export function resolvedConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    ...DEFAULT_VIEW_CONFIG,
    isMobile: false,
    sourceNoteDisplay: 'non-default',
    customFilePath: '',
    ...overrides,
  };
}

/**
 * Minimal DataTransfer shim — jsdom does not define DataTransfer.
 */
export class DataTransferStub {
  private store = new Map<string, string>();
  setData(format: string, data: string): void {
    this.store.set(format, data);
  }
  getData(format: string): string {
    return this.store.get(format) ?? '';
  }
  clearData(format?: string): void {
    if (format) this.store.delete(format);
    else this.store.clear();
  }
  get dropEffect(): string {
    return 'move';
  }
  set dropEffect(_: string) {
    /* no-op */
  }
  get effectAllowed(): string {
    return 'move';
  }
  set effectAllowed(_: string) {
    /* no-op */
  }
  get types(): string[] {
    return [...this.store.keys()];
  }
  get items(): never[] {
    return [];
  }
  get files(): never[] {
    return [];
  }
}

/**
 * Dispatch a DOM DnD event with DataTransfer support.
 * jsdom lacks DragEvent; use MouseEvent (its superclass) + defineProperty.
 */
export function dispatchDnD(
  el: HTMLElement,
  type: 'dragstart' | 'dragover' | 'dragleave' | 'drop' | 'dragend',
  payload?: string,
  relatedTarget: Node | null = null,
): DataTransferStub {
  const dt = new DataTransferStub();
  if (payload !== undefined) dt.setData('text/plain', payload);
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget });
  Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
  el.dispatchEvent(ev);
  return dt;
}

/** Fresh detached div for view render tests. */
export function freshContainer(): HTMLElement {
  return activeDocument.createElement('div');
}

/**
 * Minimal task-application harness paired with a detached TaskQueryApi.
 *
 * Command methods are inert spies; mutation integrations inject TaskApplicationApi separately.
 */
export function makeStubStore(tasks: Task[], _app?: ObsidianApp): TestTaskHarness {
  const registry = new StatusRegistry(buildDefaultTaskStatuses());
  const queries = queryApiForTasks(() => tasks);
  return {
    statusRegistry: registry,
    queries,
    taskQueries: queries,
    execute: vi.fn().mockResolvedValue({
      type: 'invalid',
      issues: [{ code: 'invalid-target' }],
    }),
    toggleTask: vi.fn().mockResolvedValue(undefined),
    setPriority: vi.fn().mockResolvedValue(undefined),
    setTaskStatus: vi.fn().mockResolvedValue(undefined),
  };
}

export function configuredTaskApplication(
  app: ObsidianApp,
  settings: CalendarSettings,
): {
  readonly index: TaskIndex;
  readonly tasks: TaskApplicationApi;
  readonly statusCatalog: StatusCatalog;
  readonly statusRegistry: StatusRegistry;
} {
  const statusCatalog = new StatusCatalog(toStatusRules(settings.taskStatuses));
  const index = new TaskIndex(app, {
    statusCatalog,
    dailyNoteFormat: settings.desktop.dailyNoteFormat,
    ...(settings.desktop.globalTaskFilter && {
      globalTaskFilter: settings.desktop.globalTaskFilter,
    }),
  });
  const repository = new ObsidianTaskRepository(app, {
    codec: new TaskMarkdownCodec(statusCatalog),
    editor: new TaskBlockEditor(),
    locator: new TaskLocator(),
    snapshotsFromContent: (path, content) => index.snapshotsFromContent(path, content),
  });
  const tasks = new TaskApplicationService(
    index,
    repository,
    statusCatalog,
    { today: () => localDate(moment().format('YYYY-MM-DD')) },
    new ObsidianTaskDestinationProvider(app, settings, new DailyNoteResolver(app, settings)),
  );
  return {
    index,
    tasks,
    statusCatalog,
    statusRegistry: new StatusRegistry(settings.taskStatuses),
  };
}

/**
 * Freeze window.moment to a known date for deterministic date-dependent tests.
 * Uses fake timers + the real moment module (which reads system time via Date).
 * Restores real timers in afterEach.
 */
export function fixedToday(dateStr: string): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(dateStr + 'T12:00:00Z'));
    (window as unknown as { moment: unknown }).moment = moment;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
