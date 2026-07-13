import { Notice, TFile, type App } from 'obsidian';
import { locatorOf, TaskMutationService } from '../mutation';
import type { Task } from '../parser/types';
import { DailyNoteResolver } from '../resolvers/DailyNoteResolver';
import { toStatusRules } from '../settings/statusCatalogAdapter';
import type { CalendarSettings } from '../settings/types';
import { StatusRegistry } from '../status/StatusRegistry';
import type { TaskPriority } from '../tasks';
import { StatusCatalog } from '../tasks/domain/StatusCatalog';
import { TaskIndex } from '../tasks/infrastructure/TaskIndex';

export class TaskStore {
  private resolver: DailyNoteResolver;
  private mutations: TaskMutationService;
  private statusCatalog: StatusCatalog;
  private readonly taskIndex: TaskIndex;
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
  }

  rebuildStatusRegistry(): void {
    this.statusRegistry = new StatusRegistry(this.settings.taskStatuses);
    this.statusCatalog = new StatusCatalog(toStatusRules(this.settings.taskStatuses));
    this.taskIndex.setStatusCatalog(this.statusCatalog);
  }

  async initialize(): Promise<void> {
    await this.taskIndex.initialize();
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

  destroy(): void {
    this.taskIndex.destroy();
  }
}
