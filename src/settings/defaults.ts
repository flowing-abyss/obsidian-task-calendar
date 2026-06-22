import type { CalendarSettings, ViewConfig } from './types'

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
}

export const DEFAULT_SETTINGS: CalendarSettings = {
  desktop: { ...DEFAULT_VIEW_CONFIG },
  mobile: { ...DEFAULT_VIEW_CONFIG, defaultView: 'list' },
  taskPrefix: '#task/one-off',
  addToToday: true,
  customFilePath: '',
}
