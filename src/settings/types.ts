import type { TaskPriority } from '../parser/types';

export interface ViewConfig {
  defaultView: 'month' | 'week' | 'list';
  firstDayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  dailyNoteFolder: string;
  dailyNoteFormat: string; // moment format, e.g. 'YYYY-MM-DD'
  upcomingDays: number;
  style: string; // CSS class, e.g. 'style1'–'style11'
  globalTaskFilter: string; // tag to strip, e.g. '#task' or ''
  startPosition: string; // 'YYYY-MM' or 'YYYY-ww' or ''
  tag: string; // scope to vault tag or ''
  folder: string; // scope to vault folder prefix or ''
}

// Fully resolved view config — produced by merging defaults → platform settings → code-block params
export interface ResolvedConfig extends ViewConfig {
  isMobile: boolean;
  sourceNoteDisplay: 'never' | 'always' | 'non-default';
  customFilePath: string;
}

export interface TagGroup {
  id: string;
  name: string;
  color?: string;
  mode: 'prefix' | 'manual';
  prefix?: string; // prefix mode: 'work' matches #work and #work/*
  tags?: string[]; // manual mode: explicit tag list
}

export interface InboxSettings {
  mode: 'tag' | 'untagged' | 'both';
  tag: string;
  showUntagged: boolean;
  removeTagOnAssign: boolean;
}

export interface CalendarSettings {
  desktop: ViewConfig;
  mobile: ViewConfig;
  taskPrefix: string;
  addToToday: boolean;
  customFilePath: string;
  inbox: InboxSettings;
  pinnedTags: string[];
  archivedTags: string[];
  tagGroups: TagGroup[];
  dailyNoteProvider: 'auto' | 'periodic-notes' | 'core' | 'obsidian-journal' | 'manual';
  manualDailyNotePath: string; // e.g. 'Daily/YYYY-MM-DD' or just 'YYYY-MM-DD'
  taskInsertionMode: 'append' | 'section';
  taskInsertionSection: string;
  sourceNoteDisplay: 'never' | 'always' | 'non-default';
  listViewStates?: Record<string, ListViewState>;
}

// Params parsed from a task-calendar code block (all optional overrides of ViewConfig)
export interface CodeBlockParams {
  view?: 'month' | 'week' | 'list';
  firstDayOfWeek?: number;
  dailyNoteFolder?: string;
  dailyNoteFormat?: string;
  upcomingDays?: number;
  style?: string;
  globalTaskFilter?: string;
  startPosition?: string;
  tag?: string;
  folder?: string;
}

export type PropertyFilter =
  | { type: 'tag'; value: string }
  | { type: 'file'; filePath: string }
  | { type: 'time'; value: string }
  | { type: 'priority'; value: TaskPriority }
  | { type: 'date'; value: string };

export interface ListViewState {
  groupBy: 'none' | 'date' | 'priority' | 'tag';
  sortBy: { field: 'date' | 'priority' | 'title' | 'tag'; dir: 'asc' | 'desc' };
  show: 'active' | 'completed' | 'all';
  filters: PropertyFilter[];
}
