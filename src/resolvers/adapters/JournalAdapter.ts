import type { App } from 'obsidian';
import type { CalendarSettings } from '../../settings/types';
import type { DailyNoteAdapter, DailyNoteProviderSettings, ProviderId } from '../types';

export class JournalAdapter implements DailyNoteAdapter {
  readonly id: ProviderId = 'obsidian-journal';

  isAvailable(app: App): boolean {
    const plugins = (app as unknown as { plugins: { getPlugin(id: string): unknown } }).plugins;
    return plugins.getPlugin('obsidian-journal') != null;
  }

  /** @experimental API not yet verified end-to-end. Falls back to empty settings. */
  getSettings(_app: App, _calSettings: CalendarSettings): DailyNoteProviderSettings {
    return { folder: '', format: 'YYYY-MM-DD', template: '' };
  }
}
