// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { App as ObsidianApp, Platform, TFile, type CachedMetadata } from 'obsidian';
import { afterEach, beforeEach, vi } from 'vitest';
import type { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import { LeftPanel } from '../src/panels/LeftPanel';
import type { Task } from '../src/parser/types';
import type { ProjectManager } from '../src/projects/ProjectManager';
import type { ProjectStore } from '../src/projects/ProjectStore';
import { buildDefaultTaskStatuses, DEFAULT_VIEW_CONFIG } from '../src/settings/defaults';
import { toStatusRules } from '../src/settings/statusCatalogAdapter';
import type { CalendarSettings, ResolvedConfig } from '../src/settings/types';
import { StatusRegistry } from '../src/status/StatusRegistry';
import type { TaskStore } from '../src/store/TaskStore';
import { TaskStore as ConcreteTaskStore } from '../src/store/TaskStore';
import type { TagManager } from '../src/tags/TagManager';
import type {
  LocalDate,
  TaskApplicationApi,
  TaskIndexEvent,
  TaskQueryApi,
  TaskSnapshot,
} from '../src/tasks';
import type { TaskQuery } from '../src/tasks/application/TaskApplicationApi';
import { TaskApplicationService } from '../src/tasks/application/TaskApplicationService';
import { legacyTaskViews } from '../src/tasks/compat/legacyTaskView';
import { StatusCatalog } from '../src/tasks/domain/StatusCatalog';
import { localDate } from '../src/tasks/domain/validation';
import { TaskIndex } from '../src/tasks/infrastructure/TaskIndex';
import { TaskBlockEditor } from '../src/tasks/infrastructure/markdown/TaskBlockEditor';
import { TaskLocator } from '../src/tasks/infrastructure/markdown/TaskLocator';
import { TaskMarkdownCodec } from '../src/tasks/infrastructure/markdown/TaskMarkdownCodec';
import { ObsidianTaskRepository } from '../src/tasks/infrastructure/obsidian/ObsidianTaskRepository';

export function taskSnapshotOf(value: Task): TaskSnapshot {
  const tags = [...value.rawText.matchAll(/#[\w/-]+/gu)].map((match) => match[0]);
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
        .filter((task) => query?.tag === undefined || task.rawText.includes(query.tag))
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

/** Test-only access to the independently queryable index injected into the command-only store. */
export function taskQueriesOf(store: TaskStore): TaskQueryApi {
  const source = store as unknown as {
    taskIndex?: TaskQueryApi;
    taskQueries?: TaskQueryApi;
  };
  const queries = source.taskIndex ?? source.taskQueries;
  if (!queries) throw new Error('Test store has no TaskQueryApi');
  return queries;
}

interface TestTaskFilter {
  dateRange?: { from: string; to: string };
  status?: Array<Task['status']>;
  filePath?: string;
  tag?: string;
  folder?: string;
}

/** Legacy view projection for command tests that need a mutation target from the query index. */
export function readStoreTasks(store: TaskStore, filter?: TestTaskFilter): Task[] {
  const query: TaskQuery | undefined = filter
    ? {
        ...(filter.filePath !== undefined && { filePath: filter.filePath }),
        ...(filter.folder !== undefined && { folder: filter.folder }),
        ...(filter.tag !== undefined && { tag: filter.tag }),
        ...(filter.status !== undefined && { statuses: filter.status }),
        ...(filter.dateRange !== undefined && {
          dateRange: {
            from: filter.dateRange.from as LocalDate,
            to: filter.dateRange.to as LocalDate,
          },
        }),
      }
    : undefined;
  return legacyTaskViews(taskQueriesOf(store).list(query));
}

export function emitStoreQueryEvent(store: TaskStore, event: TaskIndexEvent): void {
  const queries = taskQueriesOf(store) as unknown as {
    listeners: Array<(value: TaskIndexEvent) => void>;
  };
  for (const listener of [...queries.listeners]) listener(event);
}

export function makeCenterPanelForTest(
  state: AppState,
  store: TaskStore,
  app: ObsidianApp,
  settings: CalendarSettings,
  tagManager: TagManager,
  onSaveSettings: () => Promise<void> = async () => {},
  projectStore: ProjectStore | null = null,
  projectManager: ProjectManager | null = null,
  tasks?: TaskApplicationApi,
): CenterPanel {
  return new CenterPanel(
    state,
    store,
    app,
    settings,
    tagManager,
    taskQueriesOf(store),
    onSaveSettings,
    projectStore,
    projectManager,
    tasks,
  );
}

export function makeLeftPanelForTest(
  state: AppState,
  store: TaskStore,
  settings: CalendarSettings,
  tagManager: TagManager,
  app: ObsidianApp,
  onSaveSettings: () => Promise<void> = async () => {},
  projectStore: ProjectStore | null = null,
  projectManager: ProjectManager | null = null,
): LeftPanel {
  return new LeftPanel(
    state,
    store,
    settings,
    tagManager,
    app,
    taskQueriesOf(store),
    onSaveSettings,
    projectStore,
    projectManager,
  );
}

/** Canonical semantic status catalog for parser/codec compatibility tests. */
export function canonicalStatusCatalog(): StatusCatalog {
  return new StatusCatalog(toStatusRules(buildDefaultTaskStatuses()));
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

/** Build a minimal Task satisfying the Task type; overrides win. */
export function task(overrides: Partial<Task> = {}): Task {
  const text = overrides.text ?? 't';
  return {
    filePath: 'f.md',
    line: 0,
    rawText: '- [ ] t',
    text,
    markdownText: text,
    status: 'open',
    statusSymbol: ' ',
    priority: 'D',
    ...overrides,
  };
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
      // Only `start.line` is read by TaskStore; col/offset included for shape completeness.
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
 * Capture the `changed` callback TaskStore registers on metadataCache, so tests can invoke it
 * directly with a crafted (TFile, content, CachedMetadata). Needed because setCache__ fires
 * `changed` with zero args (which would crash the handler). Call BEFORE new TaskStore().initialize()
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
 * Minimal command-only TaskStore stub paired with a detached TaskQueryApi.
 *
 * Command methods are inert spies; mutation integrations inject TaskApplicationApi separately.
 */
export function makeStubStore(
  tasks: Task[],
  _app?: ObsidianApp,
): TaskStore & { taskQueries: TaskQueryApi } {
  const registry = new StatusRegistry(buildDefaultTaskStatuses());
  const store = {
    statusRegistry: registry,
    toggleTask: vi.fn().mockResolvedValue(undefined),
    setPriority: vi.fn().mockResolvedValue(undefined),
    setTaskStatus: vi.fn().mockResolvedValue(undefined),
  };
  return {
    ...store,
    taskQueries: queryApiForTasks(() => tasks),
  } as unknown as TaskStore & { taskQueries: TaskQueryApi };
}

export function configuredTaskStore(
  app: ObsidianApp,
  settings: CalendarSettings,
): ConcreteTaskStore {
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
  const tasks = new TaskApplicationService(index, repository, statusCatalog, {
    today: () => localDate(moment().format('YYYY-MM-DD')),
  });
  return new ConcreteTaskStore(app, settings, index, tasks, statusCatalog);
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
