import type { CalendarSettings, ListViewState, ProjectsSettings, ViewConfig } from './types';

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

let statusSeq = 0;
function statusId(): string {
  // Deterministic within a build; avoids Math.random. Uniqueness is all that matters.
  statusSeq += 1;
  return `status-${statusSeq}-${statusSeq * 2654435761 % 1000000}`;
}

// Export for test reset only
export function __resetStatusSeq(): void {
  statusSeq = 0;
}

export function buildDefaultProjectsSettings(): ProjectsSettings {
  const active: ProjectsSettings['statuses'][number] = {
    id: statusId(), label: 'Active', color: '#4caf50', onLeftPanel: true,
    match: { kind: 'property', property: 'status', value: 'active' },
  };
  const planned = {
    id: statusId(), label: 'Planned', color: '#2196f3', onLeftPanel: false,
    match: { kind: 'property' as const, property: 'status', value: 'planned' },
  };
  const done = {
    id: statusId(), label: 'Done', color: '#888888', onLeftPanel: false,
    match: { kind: 'property' as const, property: 'status', value: 'done' },
  };
  return {
    membershipQuery: 'Projects/',
    createFolder: 'Projects',
    templatePath: '',
    statuses: [active, planned, done],
    defaultStatusId: active.id,
  };
}

export const DEFAULT_SETTINGS: CalendarSettings = {
  desktop: { ...DEFAULT_VIEW_CONFIG },
  mobile: { ...DEFAULT_VIEW_CONFIG, defaultView: 'list' },
  taskPrefix: '#task/one-off',
  addToToday: true,
  customFilePath: '',
  inbox: {
    mode: 'tag',
    tag: '#task/inbox',
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
  projects: buildDefaultProjectsSettings(),
  sectionCollapse: { pinned: false, projects: false, tags: false },
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
