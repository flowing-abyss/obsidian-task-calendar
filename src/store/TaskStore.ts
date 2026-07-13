import { Notice, TFile, type App } from 'obsidian';
import type { Task } from '../parser/types';
import { DailyNoteResolver } from '../resolvers/DailyNoteResolver';
import { toStatusRules } from '../settings/statusCatalogAdapter';
import type { CalendarSettings } from '../settings/types';
import { StatusRegistry } from '../status/StatusRegistry';
import type { TaskApplicationApi, TaskPriority } from '../tasks';
import { taskRefOf } from '../tasks/compat/legacyTaskView';
import { StatusCatalog } from '../tasks/domain/StatusCatalog';
import { TaskIndex } from '../tasks/infrastructure/TaskIndex';
import { presentTaskCommandResult } from '../ui/taskCommandResult';

export class TaskStore {
  private resolver: DailyNoteResolver;
  private statusCatalog: StatusCatalog;
  private readonly taskIndex: TaskIndex;
  statusRegistry: StatusRegistry;

  constructor(
    private app: App,
    private settings: CalendarSettings,
    taskIndex?: TaskIndex,
    private readonly tasks?: TaskApplicationApi,
    statusCatalog?: StatusCatalog,
  ) {
    this.resolver = new DailyNoteResolver(app, settings);
    this.statusRegistry = new StatusRegistry(this.settings.taskStatuses);
    this.statusCatalog =
      statusCatalog ?? new StatusCatalog(toStatusRules(this.settings.taskStatuses));
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
    this.statusCatalog.replace(toStatusRules(this.settings.taskStatuses));
    this.taskIndex.setStatusCatalog(this.statusCatalog);
  }

  async initialize(): Promise<void> {
    await this.taskIndex.initialize();
  }

  async toggleTask(task: Task): Promise<void> {
    const ref = taskRefOf(task);
    if (!ref || !this.tasks) return;
    try {
      presentTaskCommandResult(
        await this.tasks.execute({
          type: 'toggle-completion',
          target: { type: 'task', ref },
        }),
      );
    } catch {
      new Notice('Failed to update task. Please try again.');
    }
  }

  async setTaskStatus(task: Task, char: string): Promise<void> {
    const ref = taskRefOf(task);
    if (!ref || !this.tasks) return;
    try {
      presentTaskCommandResult(
        await this.tasks.execute({
          type: 'set-status',
          target: { type: 'task', ref },
          symbol: char,
        }),
      );
    } catch {
      new Notice('Failed to update task. Please try again.');
    }
  }

  async setPriority(task: Task, priority: TaskPriority): Promise<void> {
    const ref = taskRefOf(task);
    if (!ref || !this.tasks) return;
    try {
      presentTaskCommandResult(
        await this.tasks.execute({
          type: 'patch',
          target: { type: 'task', ref },
          patch: { priority: { type: 'set', value: priority } },
        }),
      );
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
