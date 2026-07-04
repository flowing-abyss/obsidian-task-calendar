import { describe, expect, it } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { compareByStatus, groupTasksByStatus } from '../src/views/taskGrouping';

const reg = new StatusRegistry(buildDefaultTaskStatuses());
const task = (statusSymbol: string) => ({ statusSymbol, text: statusSymbol }) as any;

describe('group/sort by status', () => {
  it('groups by status name in settings order', () => {
    const groups = groupTasksByStatus([task('x'), task('!'), task(' ')], reg);
    expect(groups.map((g) => g.label)).toEqual(['To-do', 'Done', 'Important']);
  });

  it('puts unknown-status tasks in an "Other" group last', () => {
    const groups = groupTasksByStatus([task('@'), task(' ')], reg);
    expect(groups[groups.length - 1]!.label).toBe('Other');
  });

  it('compareByStatus ranks by registry order', () => {
    expect(compareByStatus(task(' '), task('x'), reg)).toBeLessThan(0);
    expect(compareByStatus(task('@'), task(' '), reg)).toBeGreaterThan(0);
  });
});
