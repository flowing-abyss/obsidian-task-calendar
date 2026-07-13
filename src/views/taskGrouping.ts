import type { Task } from '../parser/types';
import type { StatusRegistry } from '../status/StatusRegistry';
import type { TaskStatusType } from '../tasks/domain/types';

export interface TaskGroup {
  due: Task[];
  recurrence: Task[];
  overdue: Task[];
  start: Task[];
  scheduled: Task[];
  process: Task[];
  dailyNote: Task[];
  allDone: Task[];
  cancelled: Task[];
}

export function getTasksForDate(tasks: Task[], date: string, today: string): TaskGroup {
  const isSame = (d?: string) => (d ? window.moment(d).isSame(date, 'day') : false);
  const isBefore = (d?: string) => (d ? window.moment(d).isBefore(today, 'day') : false);
  const isAfter = (d?: string) => (d ? window.moment(d).isAfter(date, 'day') : false);
  const open = (t: Task) => t.status !== 'done' && t.status !== 'cancelled';

  return {
    allDone: tasks.filter(
      (t) => t.status === 'done' && (isSame(t.due) || (!t.due && isSame(t.completion))),
    ),
    due: tasks.filter((t) => open(t) && !t.recurrence && isSame(t.due)),
    recurrence: tasks.filter((t) => open(t) && t.recurrence && isSame(t.due)),
    overdue: tasks.filter((t) => open(t) && isBefore(t.due)),
    start: tasks.filter((t) => open(t) && isSame(t.start) && !isSame(t.due)),
    scheduled: tasks.filter((t) => open(t) && isSame(t.scheduled)),
    process: tasks.filter(
      (t) => open(t) && t.due && t.start && isAfter(t.due) && isBefore(t.start),
    ),
    dailyNote: tasks.filter((t) => open(t) && isSame(t.dailyNoteDate)),
    cancelled: tasks.filter((t) => t.status === 'cancelled' && isSame(t.due)),
  };
}

export function sortTasksByDateTime(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const da = a.due ?? a.scheduled ?? a.start ?? a.dailyNoteDate ?? '';
    const db = b.due ?? b.scheduled ?? b.start ?? b.dailyNoteDate ?? '';
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? -1 : 1;
    }
    const ta = a.time ?? '';
    const tb = b.time ?? '';
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // Priority first (A=Highest … F=Lowest, D=none — alphabetical order is correct)
    if (a.priority < b.priority) return -1;
    if (a.priority > b.priority) return 1;
    // Tasks with a specific time come before tasks without
    const aTime = a.time ?? '';
    const bTime = b.time ?? '';
    if (aTime && !bTime) return -1;
    if (!aTime && bTime) return 1;
    if (aTime && bTime && aTime !== bTime) return aTime < bTime ? -1 : 1;
    return a.text.localeCompare(b.text);
  });
}

const PRIORITY_LABELS: Record<string, string> = {
  A: '🔺 Highest',
  B: '⏫ High',
  C: '🔼 Medium',
  D: 'Normal',
  E: '🔽 Low',
  F: '⏬ Lowest',
};

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareNullableLast(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return compareStrings(a, b);
}

function compareByDate(a: Task, b: Task): number {
  const da = a.due ?? a.scheduled ?? a.start ?? a.dailyNoteDate ?? '';
  const db = b.due ?? b.scheduled ?? b.start ?? b.dailyNoteDate ?? '';
  const dateCmp = compareNullableLast(da, db);
  if (dateCmp !== 0) return dateCmp;
  const ta = a.time ?? '';
  const tb = b.time ?? '';
  return compareNullableLast(ta, tb);
}

function compareByTag(a: Task, b: Task): number {
  const ta = a.tags?.[0] ?? '';
  const tb = b.tags?.[0] ?? '';
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return ta.localeCompare(tb);
}

export function compareByStatus(a: Task, b: Task, registry: StatusRegistry): number {
  return registry.orderIndex(a.statusSymbol) - registry.orderIndex(b.statusSymbol);
}

export function sortTasksByField(
  tasks: Task[],
  field: 'date' | 'priority' | 'title' | 'tag' | 'status',
  dir: 'asc' | 'desc',
  registry?: StatusRegistry,
): Task[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    let cmp: number;
    if (field === 'date') {
      cmp = compareByDate(a, b);
    } else if (field === 'priority') {
      cmp = compareStrings(a.priority, b.priority);
    } else if (field === 'title') {
      cmp = a.text.localeCompare(b.text);
    } else if (field === 'status' && registry) {
      cmp = compareByStatus(a, b, registry);
    } else {
      cmp = compareByTag(a, b);
    }
    return cmp * sign;
  });
}

export function groupTasksByPriority(tasks: Task[]): Array<{ label: string; tasks: Task[] }> {
  const PRIORITY_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.priority ?? 'D';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return PRIORITY_ORDER.filter((p) => map.has(p)).map((p) => ({
    label: PRIORITY_LABELS[p] ?? p,
    tasks: map.get(p)!,
  }));
}

export function groupTasksByStatus(
  tasks: Task[],
  registry: StatusRegistry,
): Array<{ label: string; tasks: Task[] }> {
  const buckets = new Map<string, { order: number; label: string; tasks: Task[] }>();
  for (const t of tasks) {
    const def = registry.bySymbol(t.statusSymbol);
    const key = def?.id ?? '__other__';
    const label = def?.name ?? 'Other';
    const order = def ? registry.orderIndex(t.statusSymbol) : Number.MAX_SAFE_INTEGER;
    if (!buckets.has(key)) buckets.set(key, { order, label, tasks: [] });
    buckets.get(key)!.tasks.push(t);
  }
  return [...buckets.values()]
    .sort((x, y) => x.order - y.order)
    .map(({ label, tasks }) => ({ label, tasks }));
}

export function groupTasksByTag(tasks: Task[]): Array<{ label: string; tasks: Task[] }> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const tag = t.tags?.[0] ?? '';
    const key = tag || 'No tag';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const groups: Array<{ label: string; tasks: Task[] }> = [];
  for (const [label, gtasks] of map) {
    if (label !== 'No tag') groups.push({ label, tasks: gtasks });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));
  if (map.has('No tag')) groups.push({ label: 'No tag', tasks: map.get('No tag')! });
  return groups;
}

export function groupTasksByDate(
  tasks: Task[],
  today: string,
  tomorrow: string,
): Array<{ label: string; tasks: Task[] }> {
  const overdue: Task[] = [];
  const todayTasks: Task[] = [];
  const tomorrowTasks: Task[] = [];
  const upcoming: Task[] = [];
  const noDate: Task[] = [];

  for (const t of tasks) {
    const d = t.due ?? t.scheduled ?? t.start ?? t.dailyNoteDate;
    // Tasks without a date are a distinct category, not overdue.
    if (!d) noDate.push(t);
    else if (d < today) overdue.push(t);
    else if (d === today) todayTasks.push(t);
    else if (d === tomorrow) tomorrowTasks.push(t);
    else upcoming.push(t);
  }

  const result: Array<{ label: string; tasks: Task[] }> = [];
  if (overdue.length) result.push({ label: 'Overdue', tasks: overdue });
  if (todayTasks.length) result.push({ label: 'Today', tasks: todayTasks });
  if (tomorrowTasks.length) result.push({ label: 'Tomorrow', tasks: tomorrowTasks });
  if (upcoming.length) result.push({ label: 'Upcoming', tasks: upcoming });
  if (noDate.length) result.push({ label: 'No date', tasks: noDate });
  return result;
}

export function renderTaskGroup(
  container: HTMLElement,
  groups: TaskGroup,
  date: string,
  today: string,
  renderCard: (task: Task, cls: string) => HTMLElement,
): void {
  const show = (group: Task[], cls: string) => {
    for (const t of sortTasks(group)) container.appendChild(renderCard(t, cls));
  };
  if (date === today) show(groups.overdue, 'overdue');
  show(groups.due, 'due');
  show(groups.recurrence, 'recurrence');
  show(groups.start, 'start');
  show(groups.scheduled, 'scheduled');
  show(groups.process, 'process');
  show(groups.dailyNote, 'dailyNote');
  show(groups.allDone, 'done');
  show(groups.cancelled, 'cancelled');
}

// undefined, or all 4 status groups selected, means "no filtering".
// A real subset (1-3 groups) restricts tasks to those status groups.
export function filterTasksByStatusGroups(
  tasks: Task[],
  statusGroups: TaskStatusType[] | undefined,
  registry: StatusRegistry,
): Task[] {
  if (!statusGroups || statusGroups.length === 0 || statusGroups.length >= 4) return tasks;
  const allowed = new Set(statusGroups);
  return tasks.filter((t) => {
    const type = registry.bySymbol(t.statusSymbol)?.type ?? 'todo';
    return allowed.has(type);
  });
}
