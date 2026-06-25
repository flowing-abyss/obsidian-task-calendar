import type { App } from 'obsidian';
import type { CalendarSettings } from '../settings/types';

export type ProviderId = 'periodic-notes' | 'core' | 'obsidian-journal' | 'manual';

export interface DailyNoteProviderSettings {
  folder: string;
  format: string;
  template: string; // vault-relative path, '' if none
}

export interface DailyNoteAdapter {
  readonly id: ProviderId;
  isAvailable(app: App): boolean;
  getSettings(app: App, calSettings: CalendarSettings): DailyNoteProviderSettings;
}
