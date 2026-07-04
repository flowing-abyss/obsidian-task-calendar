import type {
  CalendarSettings,
  ListViewState,
  ProjectsSettings,
  TaskStatusDef,
  ViewConfig,
} from './types';

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

export function buildDefaultProjectsSettings(): ProjectsSettings {
  let n = 0;
  const statusId = (): string => {
    n += 1;
    return `status-${n}`;
  };

  const active: ProjectsSettings['statuses'][number] = {
    id: statusId(),
    label: 'Active',
    color: '#4caf50',
    onLeftPanel: true,
    match: { kind: 'property', property: 'status', value: 'active' },
  };
  const planned = {
    id: statusId(),
    label: 'Planned',
    color: '#2196f3',
    onLeftPanel: false,
    match: { kind: 'property' as const, property: 'status', value: 'planned' },
  };
  const done = {
    id: statusId(),
    label: 'Done',
    color: '#888888',
    onLeftPanel: false,
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

export function buildDefaultTaskStatuses(): TaskStatusDef[] {
  return [
    {
      id: 'status-1',
      symbol: ' ',
      name: 'To-do',
      type: 'todo',
      color: '',
      icon: '',
      iconKind: 'lucide',
      core: true,
    },
    {
      id: 'status-2',
      symbol: '/',
      name: 'In progress',
      type: 'in-progress',
      color: '#2b83f6',
      icon: 'contrast',
      iconKind: 'lucide',
      core: true,
    },
    {
      id: 'status-3',
      symbol: 'x',
      name: 'Done',
      type: 'done',
      color: '#2b83f6',
      icon: 'check',
      iconKind: 'lucide',
      core: true,
    },
    {
      id: 'status-4',
      symbol: '-',
      name: 'Cancelled',
      type: 'cancelled',
      color: '#8a8f98',
      icon: 'x',
      iconKind: 'lucide',
      core: true,
    },
    {
      id: 'status-5',
      symbol: '!',
      name: 'Important',
      type: 'todo',
      color: '#e5484d',
      icon: 'alert-triangle',
      iconKind: 'lucide',
      core: false,
    },
    {
      id: 'status-6',
      symbol: '?',
      name: 'Question',
      type: 'todo',
      color: '#8e5cf6',
      icon: 'help-circle',
      iconKind: 'lucide',
      core: false,
    },
  ];
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
  taskStatuses: buildDefaultTaskStatuses(),
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
