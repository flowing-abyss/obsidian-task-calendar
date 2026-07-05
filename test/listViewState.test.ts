import { describe, it, expect } from 'vitest';
import { isListViewCustomized, listSelectionToKey } from '../src/app/listViewState';
import { getListViewDefaults } from '../src/settings/defaults';
import type { ListViewState } from '../src/settings/types';

const base = (key: string): ListViewState => getListViewDefaults(key);

describe('isListViewCustomized', () => {
  it('returns false for a container at its defaults', () => {
    expect(isListViewCustomized(base('inbox'), 'inbox')).toBe(false);
    expect(isListViewCustomized(base('today'), 'today')).toBe(false);
  });

  it('returns true when groupBy differs from default', () => {
    expect(isListViewCustomized({ ...base('inbox'), groupBy: 'priority' }, 'inbox')).toBe(true);
  });

  it('returns true when sort field or dir differs', () => {
    expect(
      isListViewCustomized({ ...base('inbox'), sortBy: { field: 'title', dir: 'asc' } }, 'inbox'),
    ).toBe(true);
    expect(
      isListViewCustomized({ ...base('inbox'), sortBy: { field: 'date', dir: 'desc' } }, 'inbox'),
    ).toBe(true);
  });

  it('returns true when show differs', () => {
    expect(isListViewCustomized({ ...base('inbox'), show: 'all' }, 'inbox')).toBe(true);
  });

  it('returns true when there is at least one filter', () => {
    expect(
      isListViewCustomized(
        { ...base('inbox'), filters: [{ type: 'priority', value: 'A' }] },
        'inbox',
      ),
    ).toBe(true);
  });

  it('respects per-container defaults (today defaults to date grouping)', () => {
    // date grouping is the DEFAULT for today → not customized
    expect(isListViewCustomized({ ...base('today'), groupBy: 'date' }, 'today')).toBe(false);
    // but none grouping IS a change from today's default
    expect(isListViewCustomized({ ...base('today'), groupBy: 'none' }, 'today')).toBe(true);
  });
});

describe('listSelectionToKey', () => {
  it('maps smart-list strings verbatim', () => {
    expect(listSelectionToKey('inbox')).toBe('inbox');
  });
  it('maps tag/project/group selections', () => {
    expect(listSelectionToKey({ type: 'tag', tag: '#work' })).toBe('tag:#work');
    expect(listSelectionToKey({ type: 'project', path: 'A/B.md' })).toBe('project:A/B.md');
    expect(listSelectionToKey({ type: 'group', groupId: 'g1' })).toBe('group:g1');
  });
});
