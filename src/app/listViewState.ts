import type { ListSelection } from './AppState';
import { getListViewDefaults } from '../settings/defaults';
import type { ListViewState } from '../settings/types';

/** Stable persistence key for a left-panel selection (matches CenterPanel's `listViewStates` keys). */
export function listSelectionToKey(sel: ListSelection): string {
  if (typeof sel === 'string') return sel;
  if (sel.type === 'tag') return `tag:${sel.tag}`;
  if (sel.type === 'project') return `project:${sel.path}`;
  return `group:${sel.groupId}`;
}

/**
 * True when a container's view state differs from its defaults in any way that
 * warrants the left-panel "customized" dot: group/sort/show changed, OR any
 * active property filter. The text search box is global and not represented here.
 */
export function isListViewCustomized(vs: ListViewState, listKey: string): boolean {
  const defaults = getListViewDefaults(listKey);
  return (
    vs.groupBy !== defaults.groupBy ||
    vs.sortBy.field !== defaults.sortBy.field ||
    vs.sortBy.dir !== defaults.sortBy.dir ||
    vs.show !== defaults.show ||
    vs.filters.length > 0
  );
}
