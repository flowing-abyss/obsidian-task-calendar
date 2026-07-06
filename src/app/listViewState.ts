import { getListViewDefaults } from '../settings/defaults';
import type { ListViewState, TaskStatusType } from '../settings/types';
import type { ListSelection } from './AppState';

/** Stable persistence key for a left-panel selection (matches CenterPanel's `listViewStates` keys). */
export function listSelectionToKey(sel: ListSelection): string {
  if (typeof sel === 'string') return sel;
  if (sel.type === 'tag') return `tag:${sel.tag}`;
  if (sel.type === 'project') return `project:${sel.path}`;
  return `group:${sel.groupId}`;
}

// undefined, or all 4 groups selected, both mean "no filtering" (show everything) —
// normalize to undefined so the two representations compare equal.
export function normalizeStatusGroups(
  statusGroups: TaskStatusType[] | undefined,
): TaskStatusType[] | undefined {
  if (!statusGroups || statusGroups.length === 0 || statusGroups.length >= 4) return undefined;
  return statusGroups;
}

export function statusGroupsEqual(
  a: TaskStatusType[] | undefined,
  b: TaskStatusType[] | undefined,
): boolean {
  const na = normalizeStatusGroups(a);
  const nb = normalizeStatusGroups(b);
  if (na === undefined || nb === undefined) return na === nb;
  if (na.length !== nb.length) return false;
  const compare = (x: string, y: string): number => x.localeCompare(y);
  const sa = [...na].sort(compare);
  const sb = [...nb].sort(compare);
  return sa.every((v, i) => v === sb[i]);
}

/**
 * True when a container's view state differs from its defaults in any way that
 * warrants the left-panel "customized" dot: group/sort changed, the "Show"
 * status filter differs, OR any active property filter. The text search box is
 * global and not represented here.
 */
export function isListViewCustomized(vs: ListViewState, listKey: string): boolean {
  const defaults = getListViewDefaults(listKey);
  return (
    vs.groupBy !== defaults.groupBy ||
    vs.sortBy.field !== defaults.sortBy.field ||
    vs.sortBy.dir !== defaults.sortBy.dir ||
    !statusGroupsEqual(vs.statusGroups, defaults.statusGroups) ||
    vs.filters.length > 0
  );
}
