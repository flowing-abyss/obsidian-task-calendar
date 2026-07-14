import { describe, expect, it, vi } from 'vitest';
import type { TaskSnapshot as Task } from '../src/tasks';
import {
  getTasksForDate,
  groupTasksByDate,
  groupTasksByPriority,
  groupTasksByTag,
  renderTaskGroup,
  sortTasks,
  sortTasksByDateTime,
  sortTasksByField,
} from '../src/views/taskGrouping';
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
    expect(out.map((t) => t.title)).toEqual(['timed', 'noTime']);
  });

  it('within same priority and both timed, orders lex by time (zero-padded = numerically correct)', () => {
    const out = sortTasks([
      task({ text: 'b', priority: 'D', time: '10:00' }),
      task({ text: 'a', priority: 'D', time: '09:00' }),
    ]);
    expect(out.map((t) => t.planning.time)).toEqual(['09:00', '10:00']);
  });

  it('within same priority and both timed, lex compare mis-sorts unpadded hours (CURRENT BEHAVIOR, follow-up FU-8)', () => {
    const out = sortTasks([
      task({ text: 'a', priority: 'D', time: '10:00' }),
      task({ text: 'b', priority: 'D', time: '9:30' }),
    ]);
    // "9:30" > "10:00" lexically ("9" > "1"), so 9:30 sorts AFTER 10:00
    expect(out.map((t) => t.planning.time)).toEqual(['10:00', '9:30']);
  });

  it('within same priority and neither timed, orders by text.localeCompare', () => {
    const out = sortTasks([
      task({ text: 'zeta', priority: 'D' }),
      task({ text: 'alpha', priority: 'D' }),
    ]);
    expect(out.map((t) => t.title)).toEqual(['alpha', 'zeta']);
  });

  it('ignores status (no status-based ordering)', () => {
    const out = sortTasks([
      task({ text: 'done', priority: 'D', status: 'done' }),
      task({ text: 'open', priority: 'D', status: 'open' }),
    ]);
    // both priority D, no time → text.localeCompare: 'done' < 'open'
    expect(out.map((t) => t.title)).toEqual(['done', 'open']);
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

describe('sortTasksByDateTime', () => {
  it('returns empty array for empty input', () => {
    expect(sortTasksByDateTime([])).toEqual([]);
  });

  it('returns a new array (does not mutate input)', () => {
    const input: Task[] = [task({ text: 'a', due: '2026-06-25' })];
    const out = sortTasksByDateTime(input);
    expect(out).not.toBe(input);
  });

  it('sorts by date ascending when dates differ', () => {
    const out = sortTasksByDateTime([
      task({ text: 'later', due: '2026-06-26' }),
      task({ text: 'earlier', due: '2026-06-25' }),
    ]);
    expect(out.map((t) => t.title)).toEqual(['earlier', 'later']);
  });

  it('within same date, timed tasks come before untimed', () => {
    const out = sortTasksByDateTime([
      task({ text: 'noTime', due: '2026-06-25' }),
      task({ text: 'timed', due: '2026-06-25', time: '08:00' }),
    ]);
    expect(out.map((t) => t.title)).toEqual(['timed', 'noTime']);
  });

  it('within same date, timed tasks sort chronologically', () => {
    const out = sortTasksByDateTime([
      task({ text: 'afternoon', due: '2026-06-25', time: '15:00' }),
      task({ text: 'morning', due: '2026-06-25', time: '08:00' }),
      task({ text: 'evening', due: '2026-06-25', time: '20:00' }),
    ]);
    expect(out.map((t) => t.planning.time)).toEqual(['08:00', '15:00', '20:00']);
  });

  it('date ordering is not broken by time — later-date timed task stays after earlier-date untimed', () => {
    // Bug scenario from Upcoming view: Fri 26 Jun 20:00 was sorting before Tue 30 Jun (no time)
    const out = sortTasksByDateTime([
      task({ text: 'laterDateTimed', due: '2026-06-30', time: '18:00' }),
      task({ text: 'earlyDateNoTime', due: '2026-06-26' }),
      task({ text: 'earlyDateTimed', due: '2026-06-26', time: '20:00' }),
    ]);
    expect(out.map((t) => t.title)).toEqual([
      'earlyDateTimed',
      'earlyDateNoTime',
      'laterDateTimed',
    ]);
  });

  it('uses scheduled as fallback date when due is absent', () => {
    const out = sortTasksByDateTime([
      task({ text: 'b', scheduled: '2026-06-26' }),
      task({ text: 'a', scheduled: '2026-06-25' }),
    ]);
    expect(out.map((t) => t.title)).toEqual(['a', 'b']);
  });

  it('uses dailyNoteDate as fallback when due and scheduled are absent', () => {
    const out = sortTasksByDateTime([
      task({ text: 'b', dailyNoteDate: '2026-06-26' }),
      task({ text: 'a', dailyNoteDate: '2026-06-25' }),
    ]);
    expect(out.map((t) => t.title)).toEqual(['a', 'b']);
  });

  it('tasks with no date sort to end', () => {
    const out = sortTasksByDateTime([
      task({ text: 'noDate' }),
      task({ text: 'dated', due: '2026-06-25' }),
    ]);
    expect(out.map((t) => t.title)).toEqual(['dated', 'noDate']);
  });
});

describe('sortTasksByField', () => {
  it('date asc: nearest first (no date sorts last)', () => {
    const t1 = task({ due: '2026-07-01' });
    const t2 = task({ due: '2026-06-28' });
    const t3 = task({});
    const out = sortTasksByField([t1, t3, t2], 'date', 'asc');
    expect(out.map((t) => t.planning.due)).toEqual(['2026-06-28', '2026-07-01', undefined]);
  });

  it('date desc: furthest first, no-date last', () => {
    const t1 = task({ due: '2026-07-01' });
    const t2 = task({ due: '2026-06-28' });
    const out = sortTasksByField([t2, t1], 'date', 'desc');
    expect(out[0]?.planning.due).toBe('2026-07-01');
  });

  it('priority asc: A before F', () => {
    const out = sortTasksByField(
      [task({ priority: 'F' }), task({ priority: 'A' })],
      'priority',
      'asc',
    );
    expect(out[0]?.priority).toBe('A');
  });

  it('priority desc: F before A', () => {
    const out = sortTasksByField(
      [task({ priority: 'A' }), task({ priority: 'F' })],
      'priority',
      'desc',
    );
    expect(out[0]?.priority).toBe('F');
  });

  it('title asc: alphabetical', () => {
    const out = sortTasksByField(
      [task({ text: 'zebra' }), task({ text: 'apple' })],
      'title',
      'asc',
    );
    expect(out[0]?.title).toBe('apple');
  });

  it('tag asc: first tag alphabetical, untagged last', () => {
    const t1 = task({ rawText: '- [ ] task #work' });
    const t2 = task({ rawText: '- [ ] task #art' });
    const t3 = task({ rawText: '- [ ] task no tag' });
    const out = sortTasksByField([t1, t3, t2], 'tag', 'asc');
    expect((out[0]?.source.originalMarkdown.match(/#[\w/-]+/u) ?? [])[0]).toBe('#art');
    expect(out[2]?.source.originalMarkdown).toContain('no tag');
  });
});

describe('groupTasksByPriority', () => {
  it('returns groups for present priorities only', () => {
    const tasks = [task({ priority: 'A', text: 'high' }), task({ priority: 'D', text: 'normal' })];
    const groups = groupTasksByPriority(tasks);
    expect(groups.map((g) => g.label)).toContain('🔺 Highest');
    expect(groups.map((g) => g.label)).toContain('Normal');
    expect(groups.map((g) => g.label)).not.toContain('⏬ Lowest');
  });

  it('tasks with priority A appear in Highest group', () => {
    const t = task({ priority: 'A', text: 'urgent' });
    const groups = groupTasksByPriority([t]);
    const highest = groups.find((g) => g.label === '🔺 Highest');
    expect(highest?.tasks[0]?.title).toBe('urgent');
  });
});

describe('groupTasksByTag', () => {
  it('groups by first tag; untagged go to "No tag"', () => {
    const t1 = task({ rawText: '- [ ] a #work' });
    const t2 = task({ rawText: '- [ ] b #personal' });
    const t3 = task({ rawText: '- [ ] c no tag' });
    const groups = groupTasksByTag([t1, t2, t3]);
    expect(groups.map((g) => g.label)).toContain('#work');
    expect(groups.map((g) => g.label)).toContain('#personal');
    expect(groups.map((g) => g.label)).toContain('No tag');
  });
});

describe('groupTasksByDate', () => {
  it('returns Overdue group for tasks with past due date', () => {
    const t = task({ due: '2020-01-01' });
    const groups = groupTasksByDate([t], '2026-06-26', '2026-06-27');
    expect(groups[0]?.label).toBe('Overdue');
    expect(groups[0]?.tasks).toHaveLength(1);
  });
});

describe('renderTaskGroup', () => {
  it('appends nothing for all-empty groups', () => {
    const container = activeDocument.createElement('div');
    const g = getTasksForDate([], '2026-06-24', '2026-06-24');
    renderTaskGroup(container, g, '2026-06-24', '2026-06-24', (_t) =>
      activeDocument.createElement('span'),
    );
    expect(container.children).toHaveLength(0);
  });

  it('renders overdue first when date === today, then due', () => {
    const container = activeDocument.createElement('div');
    const g = getTasksForDate(
      [task({ due: '2026-06-20', text: 'overdue' }), task({ due: '2026-06-24', text: 'due' })],
      '2026-06-24',
      '2026-06-24',
    );
    const spy = vi.fn((_t: Task, cls: string) => {
      const el = activeDocument.createElement('div');
      el.className = cls;
      el.textContent = _t.title;
      return el;
    });
    renderTaskGroup(container, g, '2026-06-24', '2026-06-24', spy);
    // overdue first, then due
    expect(spy.mock.calls.map((c) => c[1])).toEqual(['overdue', 'due']);
    expect(container.children[0]?.className).toBe('overdue');
    expect(container.children[1]?.className).toBe('due');
  });

  it('does not render overdue when date !== today', () => {
    const container = activeDocument.createElement('div');
    const g = getTasksForDate(
      [task({ due: '2026-06-20', text: 'overdue' })],
      '2026-06-25',
      '2026-06-24',
    );
    const spy = vi.fn((_t: Task, _cls: string) => activeDocument.createElement('div'));
    renderTaskGroup(container, g, '2026-06-25', '2026-06-24', spy);
    expect(spy).not.toHaveBeenCalled();
    expect(container.children).toHaveLength(0);
  });

  it('renders groups in canonical order with exact cls strings', () => {
    const container = activeDocument.createElement('div');
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
      return activeDocument.createElement('div');
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
    const container = activeDocument.createElement('div');
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
      texts.push(t.title);
      return activeDocument.createElement('div');
    });
    // priority A before D → 'a' then 'b'
    expect(texts).toEqual(['a', 'b']);
  });
});
