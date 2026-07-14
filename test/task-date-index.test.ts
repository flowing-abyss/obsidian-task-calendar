import { describe, expect, it } from 'vitest';
import type { TaskSnapshot } from '../src/tasks';
import { localDate } from '../src/tasks';
import { calendarDatesForPlanning, TaskDateIndex } from '../src/tasks/infrastructure/TaskDateIndex';
import { task, useRealMoment } from './helpers';

useRealMoment();

describe('TaskDateIndex', () => {
  const createIndex = () =>
    new TaskDateIndex<TaskSnapshot>((value) => calendarDatesForPlanning(value.planning));

  it('indexes a due-only task under its due date', () => {
    const idx = createIndex();
    idx.updateFile('a.md', [task({ filePath: 'a.md', due: '2026-07-10' })]);
    expect(idx.get(localDate('2026-07-10'))).toHaveLength(1);
    expect(idx.get(localDate('2026-07-11'))).toHaveLength(0);
  });

  it('a scheduled+due-distinct task is queryable at BOTH dates (body on scheduled, deadline marker on due)', () => {
    const idx = createIndex();
    idx.updateFile('a.md', [
      task({ filePath: 'a.md', due: '2026-07-10', scheduled: '2026-07-05' }),
    ]);
    expect(idx.get(localDate('2026-07-05'))).toHaveLength(1);
    expect(idx.get(localDate('2026-07-10'))).toHaveLength(1);
  });

  it('a start+due span indexes under every day in the range inclusive', () => {
    const idx = createIndex();
    idx.updateFile('a.md', [task({ filePath: 'a.md', start: '2026-07-01', due: '2026-07-03' })]);
    expect(idx.get(localDate('2026-07-01'))).toHaveLength(1);
    expect(idx.get(localDate('2026-07-02'))).toHaveLength(1);
    expect(idx.get(localDate('2026-07-03'))).toHaveLength(1);
    expect(idx.get(localDate('2026-07-04'))).toHaveLength(0);
  });

  it('a task with no relevant date is not indexed anywhere', () => {
    const idx = createIndex();
    idx.updateFile('a.md', [task({ filePath: 'a.md' })]);
    expect(idx.get(localDate('2026-07-10'))).toHaveLength(0);
  });

  it("updateFile replaces a file's prior entries (moves task off old date)", () => {
    const idx = createIndex();
    idx.updateFile('a.md', [task({ filePath: 'a.md', due: '2026-07-10' })]);
    idx.updateFile('a.md', [task({ filePath: 'a.md', due: '2026-07-11' })]);
    expect(idx.get(localDate('2026-07-10'))).toHaveLength(0);
    expect(idx.get(localDate('2026-07-11'))).toHaveLength(1);
  });

  it("updateFile with an empty array clears the file's entries (no ghost tasks)", () => {
    const idx = createIndex();
    idx.updateFile('a.md', [task({ filePath: 'a.md', due: '2026-07-10' })]);
    idx.updateFile('a.md', []);
    expect(idx.get(localDate('2026-07-10'))).toHaveLength(0);
  });

  it("removeFile clears all of that file's entries", () => {
    const idx = createIndex();
    idx.updateFile('a.md', [task({ filePath: 'a.md', due: '2026-07-10' })]);
    idx.removeFile('a.md');
    expect(idx.get(localDate('2026-07-10'))).toHaveLength(0);
  });

  it('two files contributing to the same date both appear, and removing one leaves the other', () => {
    const idx = createIndex();
    idx.updateFile('a.md', [task({ filePath: 'a.md', due: '2026-07-10' })]);
    idx.updateFile('b.md', [task({ filePath: 'b.md', due: '2026-07-10' })]);
    expect(idx.get(localDate('2026-07-10'))).toHaveLength(2);
    idx.removeFile('a.md');
    const remaining = idx.get(localDate('2026-07-10'));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.source.filePath).toBe('b.md');
  });

  it('a malformed start > due does not spin forever (guarded)', () => {
    const idx = createIndex();
    idx.updateFile('a.md', [task({ filePath: 'a.md', start: '2027-01-01', due: '2026-01-01' })]);
    // start after due: loop guard means it terminates; exact bucket assignment is not asserted,
    // only that this call returns and doesn't hang.
    expect(() => idx.get(localDate('2026-01-01'))).not.toThrow();
  });

  it('clear() empties the whole index', () => {
    const idx = createIndex();
    idx.updateFile('a.md', [task({ filePath: 'a.md', due: '2026-07-10' })]);
    idx.clear();
    expect(idx.get(localDate('2026-07-10'))).toHaveLength(0);
  });
});
