import { TFile, normalizePath, type App } from 'obsidian';
import type { DailyNoteResolver } from '../../../resolvers/DailyNoteResolver';
import type { CalendarSettings } from '../../../settings/types';
import type {
  TaskDestinationProvider,
  TaskDestinationResolution,
} from '../../application/TaskDestinationProvider';
import type { TaskDestination, TaskInsertionPolicy } from '../../domain/types';

function configuredInsertion(settings: CalendarSettings): TaskInsertionPolicy {
  return settings.taskInsertionMode === 'section' && settings.taskInsertionSection.trim().length > 0
    ? { type: 'section', heading: settings.taskInsertionSection }
    : { type: 'append' };
}

export class ObsidianTaskDestinationProvider implements TaskDestinationProvider {
  constructor(
    private readonly app: App,
    private readonly settings: CalendarSettings,
    private readonly dailyNotes: DailyNoteResolver,
  ) {}

  async resolveConfiguredDefault(): Promise<TaskDestinationResolution> {
    try {
      if (this.settings.addToToday) {
        return {
          type: 'resolved',
          destination: await this.dailyNotes.resolveDailyNoteDestination(),
        };
      }
      const configuredPath = this.settings.customFilePath.trim();
      if (configuredPath.length === 0) return { type: 'unavailable' };
      return this.prepare({
        filePath: configuredPath,
        insertion: configuredInsertion(this.settings),
      });
    } catch {
      return { type: 'unavailable' };
    }
  }

  async prepare(destination: TaskDestination): Promise<TaskDestinationResolution> {
    try {
      const filePath = normalizePath(destination.filePath);
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (!(existing instanceof TFile)) await this.app.vault.create(filePath, '');
      const prepared = this.app.vault.getAbstractFileByPath(filePath);
      if (!(prepared instanceof TFile)) return { type: 'unavailable' };
      return {
        type: 'resolved',
        destination: { filePath: prepared.path, insertion: destination.insertion },
      };
    } catch {
      return { type: 'unavailable' };
    }
  }
}
