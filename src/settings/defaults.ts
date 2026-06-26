import type { CalendarSettings, ListViewState, ViewConfig } from './types';

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  defaultView: 'month',
  firstDayOfWeek: 1,
  dailyNoteFolder: 'periodic/daily',
  dailyNoteFormat: 'YYYY-MM-DD',
  upcomingDays: 7,
  style: 'style1',
  globalTaskFilter: '',
  startPosition: '',
  tag: '',
  folder: '',
};

export const DEFAULT_SETTINGS: CalendarSettings = {
  desktop: { ...DEFAULT_VIEW_CONFIG },
  mobile: { ...DEFAULT_VIEW_CONFIG, defaultView: 'list' },
  taskPrefix: '#task/one-off',
  addToToday: true,
  customFilePath: '',
  inbox: {
    mode: 'tag',
    tag: '#task/inbox',
    showUntagged: false,
    removeTagOnAssign: true,
  },
  pinnedTags: [],
  archivedTags: [],
  tagGroups: [],
  dailyNoteProvider: 'auto',
  manualDailyNotePath: 'YYYY-MM-DD',
  taskInsertionMode: 'append',
  taskInsertionSection: '## Tasks',
  sourceNoteDisplay: 'non-default' as const,
};

export function getListViewDefaults(listKey: string): ListViewState {
  const useDateGrouping = listKey === 'today' || listKey === 'upcoming';
  return {
    groupBy: useDateGrouping ? 'date' : 'none',
    sortBy: { field: 'date', dir: 'asc' },
    show: 'active',
    filters: [],
  };
}
