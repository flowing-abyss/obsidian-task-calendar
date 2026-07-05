import type { TaskStatusType } from '../settings/types';

/** Canonical display/grouping order for the four status types. */
export const TYPE_ORDER: TaskStatusType[] = ['todo', 'in-progress', 'done', 'cancelled'];

/** Human-readable labels for the four status types, used by settings/menus. */
export const TYPE_LABELS: Record<TaskStatusType, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** The "Active" statusGroups preset: not-yet-done work. */
export const ACTIVE_STATUS_GROUPS: TaskStatusType[] = ['todo', 'in-progress'];

/** The "All" statusGroups preset: every status type. */
export const ALL_STATUS_GROUPS: TaskStatusType[] = [...TYPE_ORDER];
