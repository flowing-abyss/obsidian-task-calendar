import { Notice, TFile, type App } from 'obsidian';
import { locatorOf, TaskMutationService } from '../mutation';
import type { Task, TaskFilter } from '../parser/types';
import { DailyNoteResolver } from '../resolvers/DailyNoteResolver';
import { toStatusRules } from '../settings/statusCatalogAdapter';
import type { CalendarSettings } from '../settings/types';
import { StatusRegistry } from '../status/StatusRegistry';
import type { LocalDate, TaskIndexEvent, TaskPriority, TaskQuery, TaskQueryApi } from '../tasks';
import { legacyTaskViews } from '../tasks/compat/legacyTaskView';
import { StatusCatalog } from '../tasks/domain/StatusCatalog';
import { TaskIndex } from '../tasks/infrastructure/TaskIndex';

interface StoreUpdateEvent {
  changedFiles: string[];
}

type UpdateCallback = (event: StoreUpdateEvent) => void;

export class TaskStore {
  private listeners: UpdateCallback[] = [];
  private pendingFiles = new Set<string>();
  private flushScheduled = false;
  private resolver: DailyNoteResolver;
  private mutations: TaskMutationService;
  private statusCatalog: StatusCatalog;
  private readonly taskIndex: TaskIndex;
  private readonly queries: TaskQueryApi;
  private readonly unsubscribeIndex: () => void;
  statusRegistry: StatusRegistry;

  constructor(
    private app: App,
    private settings: CalendarSettings,
    taskIndex?: TaskIndex,
  ) {
    this.resolver = new DailyNoteResolver(app, settings);
    this.statusRegistry = new StatusRegistry(this.settings.taskStatuses);
    this.statusCatalog = new StatusCatalog(toStatusRules(this.settings.taskStatuses));
    this.mutations = new TaskMutationService(
      app,
      () => this.statusRegistry,
      () => this.statusCatalog,
    );
    this.taskIndex =
      taskIndex ??
      new TaskIndex(app, {
        statusCatalog: this.statusCatalog,
        dailyNoteFormat: settings.desktop.dailyNoteFormat,
        ...(settings.desktop.globalTaskFilter && {
          globalTaskFilter: settings.desktop.globalTaskFilter,
        }),
      });
    this.queries = this.taskIndex;
    this.unsubscribeIndex = this.queries.subscribe((event: TaskIndexEvent) => {
      if (event.type === 'initialized') this.notify({ changedFile: undefined });
      else if (event.type === 'changed') {
        for (const file of event.files) this.pendingFiles.add(file);
        this.notify({ changedFile: undefined });
      } else if (event.type === 'renamed') this.notify({ changedFile: event.newPath });
      else this.notify({ changedFile: event.path });
    });
  }

  rebuildStatusRegistry(): void {
    this.statusRegistry = new StatusRegistry(this.settings.taskStatuses);
    this.statusCatalog = new StatusCatalog(toStatusRules(this.settings.taskStatuses));
    this.taskIndex.setStatusCatalog(this.statusCatalog);
  }

  get taskQueries(): TaskQueryApi {
    return this.queries;
  }

  async initialize(): Promise<void> {
    await this.taskIndex.initialize();
  }

  getTasks(filter?: TaskFilter): Task[] {
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
    return legacyTaskViews(this.queries.list(query));
  }

  getTasksForDate(date: string): Task[] {
    return legacyTaskViews(this.queries.forCalendarDates([date as LocalDate]));
  }

  getTasksForDateRange(dates: string[]): Task[] {
    return legacyTaskViews(this.queries.forCalendarDates(dates as LocalDate[]));
  }

  async toggleTask(task: Task): Promise<void> {
    const today = window.moment().format('YYYY-MM-DD');
    try {
      await this.mutations.toggleCompletion(locatorOf(task), today);
    } catch {
      new Notice('Failed to update task. Please try again.');
    }
  }

  async setTaskStatus(task: Task, char: string): Promise<void> {
    const today = window.moment().format('YYYY-MM-DD');
    try {
      await this.mutations.setStatusChar(locatorOf(task), char, today);
    } catch {
      new Notice('Failed to update task. Please try again.');
    }
  }

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
      if (existing instanceof TFile) file = existing;
      else {
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
      this.listeners = this.listeners.filter((listener) => listener !== callback);
    };
  }

  destroy(): void {
    this.unsubscribeIndex();
    this.taskIndex.destroy();
    this.listeners = [];
    this.pendingFiles.clear();
  }

  private notify(event: { changedFile?: string }): void {
    if (event.changedFile) this.pendingFiles.add(event.changedFile);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    void Promise.resolve().then(() => {
      this.flushScheduled = false;
      const changedFiles = [...this.pendingFiles];
      this.pendingFiles.clear();
      for (const listener of [...this.listeners]) listener({ changedFiles });
    });
  }
}
