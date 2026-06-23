import type { Task } from '../parser/types';

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

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.priority < b.priority) return -1;
    if (a.priority > b.priority) return 1;
    return a.text.localeCompare(b.text);
  });
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
