import type { App } from 'obsidian';
import type { CalendarSettings } from '../../settings/types';
import type { DailyNoteAdapter, DailyNoteProviderSettings, ProviderId } from '../types';

export class ManualAdapter implements DailyNoteAdapter {
  readonly id: ProviderId = 'manual';

  isAvailable(_app: App): boolean {
    return true;
  }

  getSettings(_app: App, calSettings: CalendarSettings): DailyNoteProviderSettings {
    return {
      folder: calSettings.desktop.dailyNoteFolder,
      format: calSettings.desktop.dailyNoteFormat,
      template: '',
    };
  }
}
