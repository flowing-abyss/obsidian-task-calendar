import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/parser/types';
import { getTasksForDate, renderTaskGroup, sortTasks } from '../src/views/taskGrouping';
import { task, useRealMoment } from './helpers';

useRealMoment();

describe('sortTasks', () => {
  it('returns an empty array for empty input', () => {
    expect(sortTasks([])).toEqual([]);
  });

  it('returns a new array (does not mutate input)', () => {
    const input: Task[] = [task({ text: 'a' })];
    const out = sortTasks(input);
    expect(out).not.toBe(input);
    expect(out).toHaveLength(1);
  });

  it('orders by priority ascending A..F', () => {
    const out = sortTasks([
      task({ text: 'low', priority: 'F' }),
      task({ text: 'high', priority: 'A' }),
      task({ text: 'mid', priority: 'C' }),
    ]);
    expect(out.map((t) => t.priority)).toEqual(['A', 'C', 'F']);
  });

  it('within same priority, timed tasks come before untimed', () => {
    const out = sortTasks([
      task({ text: 'noTime', priority: 'D' }),
      task({ text: 'timed', priority: 'D', time: '09:00' }),
    ]);
    expect(out.map((t) => t.text)).toEqual(['timed', 'noTime']);
  });

  it('within same priority and both timed, orders lex by time (zero-padded = numerically correct)', () => {
    const out = sortTasks([
      task({ text: 'b', priority: 'D', time: '10:00' }),
      task({ text: 'a', priority: 'D', time: '09:00' }),
    ]);
    expect(out.map((t) => t.time)).toEqual(['09:00', '10:00']);
  });

  it('within same priority and both timed, lex compare mis-sorts unpadded hours (CURRENT BEHAVIOR, follow-up FU-8)', () => {
    const out = sortTasks([
      task({ text: 'a', priority: 'D', time: '10:00' }),
      task({ text: 'b', priority: 'D', time: '9:30' }),
    ]);
    // "9:30" > "10:00" lexically ("9" > "1"), so 9:30 sorts AFTER 10:00
    expect(out.map((t) => t.time)).toEqual(['10:00', '9:30']);
  });

  it('within same priority and neither timed, orders by text.localeCompare', () => {
    const out = sortTasks([
      task({ text: 'zeta', priority: 'D' }),
      task({ text: 'alpha', priority: 'D' }),
    ]);
    expect(out.map((t) => t.text)).toEqual(['alpha', 'zeta']);
  });

  it('ignores status (no status-based ordering)', () => {
    const out = sortTasks([
      task({ text: 'done', priority: 'D', status: 'done' }),
      task({ text: 'open', priority: 'D', status: 'open' }),
    ]);
    // both priority D, no time → text.localeCompare: 'done' < 'open'
    expect(out.map((t) => t.text)).toEqual(['done', 'open']);
  });
});

describe('getTasksForDate', () => {
  const DATE = '2026-06-24';
  const TODAY = '2026-06-24';

  it('places an open non-recurring task due on date into due', () => {
    const g = getTasksForDate([task({ due: DATE })], DATE, TODAY);
    expect(g.due).toHaveLength(1);
    expect(g.recurrence).toHaveLength(0);
  });

  it('places an open recurring task due on date into recurrence (not due)', () => {
    const g = getTasksForDate([task({ due: DATE, recurrence: 'every week' })], DATE, TODAY);
    expect(g.recurrence).toHaveLength(1);
    expect(g.due).toHaveLength(0);
  });

  it('places an open task due before today into overdue (regardless of date)', () => {
    const g = getTasksForDate([task({ due: '2026-06-20' })], DATE, TODAY);
    expect(g.overdue).toHaveLength(1);
  });

  it('places an open recurring task due before today into overdue (no !recurrence guard)', () => {
    const g = getTasksForDate([task({ due: '2026-06-20', recurrence: 'every week' })], DATE, TODAY);
    expect(g.overdue).toHaveLength(1);
    expect(g.recurrence).toHaveLength(0);
  });

  it('places an open task with start on date and due not on date into start', () => {
    const g = getTasksForDate([task({ start: DATE, due: '2026-06-28' })], DATE, TODAY);
    expect(g.start).toHaveLength(1);
  });

  it('places an open task scheduled on date into scheduled', () => {
    const g = getTasksForDate([task({ scheduled: DATE })], DATE, TODAY);
    expect(g.scheduled).toHaveLength(1);
  });

  it('places an open task with due after date and start before today into process', () => {
    const g = getTasksForDate([task({ due: '2026-06-28', start: '2026-06-20' })], DATE, TODAY);
    expect(g.process).toHaveLength(1);
  });

  it('places an open task with dailyNoteDate on date into dailyNote', () => {
    const g = getTasksForDate([task({ dailyNoteDate: DATE })], DATE, TODAY);
    expect(g.dailyNote).toHaveLength(1);
  });

  it('places a done task due on date into allDone', () => {
    const g = getTasksForDate([task({ due: DATE, status: 'done' })], DATE, TODAY);
    expect(g.allDone).toHaveLength(1);
    expect(g.due).toHaveLength(0);
  });

  it('places a done task with no due but completion on date into allDone', () => {
    const g = getTasksForDate([task({ completion: DATE, status: 'done' })], DATE, TODAY);
    expect(g.allDone).toHaveLength(1);
  });

  it('places a cancelled task due on date into cancelled', () => {
    const g = getTasksForDate([task({ due: DATE, status: 'cancelled' })], DATE, TODAY);
    expect(g.cancelled).toHaveLength(1);
    expect(g.due).toHaveLength(0);
  });

  it('excludes closed tasks from due/overdue/start/scheduled/process/dailyNote', () => {
    const done = task({ due: DATE, status: 'done' });
    const cancelled = task({ due: DATE, status: 'cancelled' });
    const g = getTasksForDate([done, cancelled], DATE, TODAY);
    expect(g.due).toHaveLength(0);
    expect(g.overdue).toHaveLength(0);
    expect(g.start).toHaveLength(0);
    expect(g.scheduled).toHaveLength(0);
    expect(g.process).toHaveLength(0);
    expect(g.dailyNote).toHaveLength(0);
  });

  it('places a task with no dates into no group', () => {
    const g = getTasksForDate([task()], DATE, TODAY);
    expect(g.due).toHaveLength(0);
    expect(g.overdue).toHaveLength(0);
    expect(g.start).toHaveLength(0);
    expect(g.scheduled).toHaveLength(0);
    expect(g.dailyNote).toHaveLength(0);
  });

  it('a task can appear in multiple groups (no de-duplication): overdue + start', () => {
    // due < today (overdue) AND start == date == today (start)
    const g = getTasksForDate([task({ due: '2026-06-20', start: DATE })], DATE, TODAY);
    expect(g.overdue).toHaveLength(1);
    expect(g.start).toHaveLength(1);
  });
});

describe('renderTaskGroup', () => {
  it('appends nothing for all-empty groups', () => {
    const container = document.createElement('div');
    const g = getTasksForDate([], '2026-06-24', '2026-06-24');
    renderTaskGroup(container, g, '2026-06-24', '2026-06-24', (t) =>
      document.createElement('span'),
    );
    expect(container.children).toHaveLength(0);
  });

  it('renders overdue first when date === today, then due', () => {
    const container = document.createElement('div');
    const g = getTasksForDate(
      [task({ due: '2026-06-20', text: 'overdue' }), task({ due: '2026-06-24', text: 'due' })],
      '2026-06-24',
      '2026-06-24',
    );
    const spy = vi.fn((_t: Task, cls: string) => {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = _t.text;
      return el;
    });
    renderTaskGroup(container, g, '2026-06-24', '2026-06-24', spy);
    // overdue first, then due
    expect(spy.mock.calls.map((c) => c[1])).toEqual(['overdue', 'due']);
    expect(container.children[0]?.className).toBe('overdue');
    expect(container.children[1]?.className).toBe('due');
  });

  it('does not render overdue when date !== today', () => {
    const container = document.createElement('div');
    const g = getTasksForDate(
      [task({ due: '2026-06-20', text: 'overdue' })],
      '2026-06-25',
      '2026-06-24',
    );
    const spy = vi.fn((_t: Task, cls: string) => document.createElement('div'));
    renderTaskGroup(container, g, '2026-06-25', '2026-06-24', spy);
    expect(spy).not.toHaveBeenCalled();
    expect(container.children).toHaveLength(0);
  });

  it('renders groups in canonical order with exact cls strings', () => {
    const container = document.createElement('div');
    const g = {
      due: [task({ text: 'd' })],
      recurrence: [task({ text: 'r', recurrence: 'every week', due: '2026-06-24' })],
      overdue: [],
      start: [task({ text: 's', start: '2026-06-24', due: '2026-06-28' })],
      scheduled: [task({ text: 'sc', scheduled: '2026-06-24' })],
      process: [],
      dailyNote: [task({ text: 'dn', dailyNoteDate: '2026-06-24' })],
      allDone: [task({ text: 'ad', status: 'done', due: '2026-06-24' })],
      cancelled: [task({ text: 'ca', status: 'cancelled', due: '2026-06-24' })],
    };
    const classes: string[] = [];
    renderTaskGroup(container, g, '2026-06-25', '2026-06-25', (t, cls) => {
      classes.push(cls);
      return document.createElement('div');
    });
    // date !== today → no overdue; order: due, recurrence, start, scheduled, dailyNote, allDone(cls:'done'), cancelled
    expect(classes).toEqual([
      'due',
      'recurrence',
      'start',
      'scheduled',
      'dailyNote',
      'done',
      'cancelled',
    ]);
  });

  it('sorts tasks within a group via sortTasks', () => {
    const container = document.createElement('div');
    const g = {
      due: [task({ text: 'b', priority: 'D' }), task({ text: 'a', priority: 'A' })],
      recurrence: [],
      overdue: [],
      start: [],
      scheduled: [],
      process: [],
      dailyNote: [],
      allDone: [],
      cancelled: [],
    };
    const texts: string[] = [];
    renderTaskGroup(container, g, '2026-06-24', '2026-06-24', (t) => {
      texts.push(t.text);
      return document.createElement('div');
    });
    // priority A before D → 'a' then 'b'
    expect(texts).toEqual(['a', 'b']);
  });
});
