import type { SubTask, Task } from '../parser/types';
import { getListViewDefaults } from '../settings/defaults';
import type { ListViewState } from '../settings/types';

export type ViewMode = 'tasks' | 'calendar' | 'search' | 'projects';

export type ListSelection =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | { type: 'tag'; tag: string }
  | { type: 'group'; groupId: string }
  | { type: 'project'; path: string };

type ProjectsPanelState = { view: 'list' } | { view: 'dashboard'; path: string };

export interface AppStateData {
  mode: ViewMode;
  selectedList: ListSelection;
  taskStack: Array<Task | SubTask>;
  centerFilter: string;
  searchQuery: string;
  draggingTask: Task | null;
  draggingTag: string | null;
  draggingProject: string | null;
  centerListViewState: ListViewState;
  projectsPanel: ProjectsPanelState;
}

type Listener<T> = (value: T, prev: T) => void;

export class AppState {
  private data: AppStateData = {
    mode: 'tasks',
    selectedList: 'today',
    taskStack: [],
    centerFilter: '',
    searchQuery: '',
    draggingTask: null,
    draggingTag: null,
    draggingProject: null,
    centerListViewState: getListViewDefaults('today'),
    projectsPanel: { view: 'list' },
  };

  private listeners = new Map<keyof AppStateData, Set<Listener<unknown>>>();

  get<K extends keyof AppStateData>(key: K): AppStateData[K] {
    return this.data[key];
  }

  set<K extends keyof AppStateData>(key: K, value: AppStateData[K]): void {
    const prev = this.data[key];
    if (prev === value) return;
    this.data[key] = value;
    const bucket = this.listeners.get(key);
    if (bucket) {
      for (const cb of bucket) cb(value, prev);
    }
  }

  on<K extends keyof AppStateData>(key: K, listener: Listener<AppStateData[K]>): () => void {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    const bucket = this.listeners.get(key)!;
    bucket.add(listener as Listener<unknown>);
    return () => {
      bucket.delete(listener as Listener<unknown>);
    };
  }
}
