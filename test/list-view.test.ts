import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { LinkToken } from '../src/parser/links';
import type { Task } from '../src/parser/types';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { ListView } from '../src/views/ListView';
import { freshContainer, resolvedConfig, task, useRealMoment } from './helpers';

useRealMoment();

const today = () => window.moment().format('YYYY-MM-DD');
const yesterday = () => window.moment().subtract(1, 'day').format('YYYY-MM-DD');

function fakeApp(): App {
  return {} as App;
}

function makeView(
  callbacks: Partial<{
    onToggle: (t: Task) => void;
    onDateClick: (d: string) => void;
    onTaskClick: (t: Task) => void;
    onEditLink: (t: Task, occ: number, token: LinkToken) => void;
    onContextMenu: (ev: MouseEvent, t: Task) => void;
  }> = {},
) {
  const spies = {
    app: fakeApp(),
    onToggle: vi.fn(callbacks.onToggle),
    onDateClick: vi.fn(callbacks.onDateClick),
    onTaskClick: vi.fn(callbacks.onTaskClick),
    onEditLink: vi.fn(callbacks.onEditLink),
    statusRegistry: new StatusRegistry(buildDefaultTaskStatuses()),
    onContextMenu: vi.fn(callbacks.onContextMenu),
  };
  const view = new ListView(spies);
  return { view, spies };
}

describe('ListView', () => {
  describe('render contract', () => {
    it('empty tasks → only .tc-list-view, no sections', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      expect(c.querySelector('.tc-list-view')).not.toBeNull();
      expect(c.querySelectorAll('.tc-list-section')).toHaveLength(0);
    });

    it('overdue task → one overdue section with count + one task row', () => {
      const { view } = makeView();
      const c = freshContainer();
      const t = task({ due: yesterday(), status: 'open' });
      view.render(c, [t], resolvedConfig());
      const header = c.querySelector('.tc-list-overdue-header');
      expect(header).not.toBeNull();
      expect(header?.querySelector('.tc-list-date-count')?.textContent).toBe('1');
      expect(c.querySelectorAll('.tc-list-task')).toHaveLength(1);
    });

    it('overdue count span equals overdueTasks.length', () => {
      const { view } = makeView();
      const c = freshContainer();
      const tasks = [
        task({ text: 'a', due: '2020-01-01', status: 'open' }),
        task({ text: 'b', due: '2020-01-02', status: 'open' }),
      ];
      view.render(c, tasks, resolvedConfig());
      expect(c.querySelector('.tc-list-overdue-header .tc-list-date-count')?.textContent).toBe('2');
    });

    it('done task with due today → NOT shown (only open tasks)', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [task({ due: today(), status: 'done' })], resolvedConfig());
      expect(c.querySelectorAll('.tc-list-task')).toHaveLength(0);
    });

    it('cancelled task → NOT shown', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [task({ due: today(), status: 'cancelled' })], resolvedConfig());
      expect(c.querySelectorAll('.tc-list-task')).toHaveLength(0);
    });

    it('task due today → date label "Today"', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [task({ due: today(), status: 'open' })], resolvedConfig());
      const labels = c.querySelectorAll('.tc-list-date-label');
      const hasToday = Array.from(labels).some((l) => l.textContent === 'Today');
      expect(hasToday).toBe(true);
    });

    it('task due yesterday → date label "Yesterday"', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [task({ due: yesterday(), status: 'open' })], resolvedConfig());
      // yesterday is overdue, so it goes to overdue section, not day section
      // CURRENT BEHAVIOR: overdue tasks are in "Overdue" section, not "Yesterday"
      expect(c.querySelector('.tc-list-overdue-header .tc-list-date-label')?.textContent).toBe(
        'Overdue',
      );
    });

    it('other date → label formatted ddd, D MMM', () => {
      const { view } = makeView();
      const c = freshContainer();
      // Pick a future date within the current month that isn't today/yesterday.
      // ListView only renders the current month, and past dates go to the Overdue
      // section (which uses the "Overdue" label, not the ddd, D MMM format).
      const m = window.moment().add(2, 'days');
      if (m.format('YYYY-MM-DD') === today()) m.add(1, 'day');
      const d = m.format('YYYY-MM-DD');
      view.render(c, [task({ due: d, status: 'open' })], resolvedConfig());
      const labels = c.querySelectorAll('.tc-list-date-label');
      const label = Array.from(labels).find((l) => l.textContent !== 'Overdue');
      expect(label?.textContent ?? '').toMatch(/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2}$/);
    });

    it('dedup: task in multiple groups renders once', () => {
      const { view } = makeView();
      const c = freshContainer();
      const d = today();
      // due AND scheduled on same day → appears in both groups, deduped to one row
      const t = task({ due: d, scheduled: d, status: 'open' });
      view.render(c, [t], resolvedConfig());
      expect(c.querySelectorAll('.tc-list-task')).toHaveLength(1);
    });

    it('tasks sorted by priority then time then text', () => {
      const { view } = makeView();
      const c = freshContainer();
      const d = today();
      // Distinct filePath/line so dedup doesn't collapse rows (task() defaults to line 0).
      // Titles render via MarkdownRenderer (mocked as a noop in tests), so row order is
      // asserted via the plain-text time badge instead of the title's textContent.
      const tasks = [
        task({ text: 'zzz', due: d, priority: 'D', status: 'open', line: 1, time: '23:00' }),
        task({ text: 'aaa', due: d, priority: 'A', status: 'open', line: 2, time: '10:00' }),
        task({ text: 'bbb', due: d, priority: 'A', time: '09:00', status: 'open', line: 3 }),
      ];
      view.render(c, tasks, resolvedConfig());
      const times = Array.from(c.querySelectorAll('.tc-task-time')).map((el) => el.textContent);
      expect(times).toEqual(['09:00', '10:00', '23:00']);
    });
  });

  describe('interactions', () => {
    it('clicking date header invokes onDateClick(currentDate)', () => {
      const { view, spies } = makeView({ onDateClick: (d) => d });
      const c = freshContainer();
      const d = today();
      view.render(c, [task({ due: d, status: 'open' })], resolvedConfig());
      const header = c.querySelector('.tc-list-date-header') as HTMLElement;
      header.click();
      expect(spies.onDateClick).toHaveBeenCalledWith(d);
    });

    it('clicking task row invokes onTaskClick', () => {
      const { view, spies } = makeView({ onTaskClick: (t) => t });
      const c = freshContainer();
      const t = task({ due: today(), status: 'open' });
      view.render(c, [t], resolvedConfig());
      const row = c.querySelector('.tc-list-task') as HTMLElement;
      row.click();
      expect(spies.onTaskClick).toHaveBeenCalledWith(t);
    });

    it('clicking the status marker invokes onToggle and does not also invoke onTaskClick', () => {
      const { view, spies } = makeView({ onToggle: (t) => t });
      const c = freshContainer();
      const t = task({ due: today(), status: 'open' });
      view.render(c, [t], resolvedConfig());
      const marker = c.querySelector('.tc-status-marker') as HTMLElement;
      marker.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(spies.onToggle).toHaveBeenCalledWith(t);
      expect(spies.onTaskClick).not.toHaveBeenCalled();
    });

    it('right-clicking the status marker invokes onContextMenu with the task', () => {
      const { view, spies } = makeView();
      const c = freshContainer();
      const t = task({ due: today(), status: 'open' });
      view.render(c, [t], resolvedConfig());
      const marker = c.querySelector('.tc-status-marker') as HTMLElement;
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      marker.dispatchEvent(ev);
      expect(spies.onContextMenu).toHaveBeenCalledWith(ev, t);
    });

    it('status marker data-status-type reflects an open task', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [task({ due: today(), status: 'open' })], resolvedConfig());
      const marker = c.querySelector('.tc-status-marker') as HTMLElement;
      expect(marker.getAttribute('data-status-type')).toBe('todo');
    });

    it('is-done class on title when status done — N/A (done tasks filtered)', () => {
      // CURRENT BEHAVIOR: done tasks are never rendered in ListView, so is-done class
      // never appears. Pin the absence.
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [task({ due: today(), status: 'done' })], resolvedConfig());
      expect(c.querySelectorAll('.is-done')).toHaveLength(0);
    });

    it('meta: tc-task-time span shows task.time when present', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [task({ due: today(), time: '14:30', status: 'open' })], resolvedConfig());
      expect(c.querySelector('.tc-task-time')?.textContent).toBe('14:30');
    });

    it('meta: no tc-task-time span when time absent', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [task({ due: today(), status: 'open' })], resolvedConfig());
      expect(c.querySelector('.tc-task-time')).toBeNull();
    });

    it('meta: first tag shown as tc-task-tag', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(
        c,
        [task({ due: today(), rawText: '- [ ] t #work #urgent', status: 'open' })],
        resolvedConfig(),
      );
      expect(c.querySelector('.tc-task-tag')?.textContent).toBe('#work');
    });

    it('meta: only first tag (slice 0,1)', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(
        c,
        [task({ due: today(), rawText: '- [ ] t #work #urgent', status: 'open' })],
        resolvedConfig(),
      );
      expect(c.querySelectorAll('.tc-task-tag')).toHaveLength(1);
    });

    it('meta: subtask progress shown as done/total', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(
        c,
        [
          task({
            due: today(),
            status: 'open',
            subtasks: [
              {
                filePath: 'f.md',
                line: 1,
                rawText: '  - [x] a',
                text: 'a',
                markdownText: 'a',
                status: 'done',
                statusSymbol: 'x',
                priority: 'D' as const,
              },
              {
                filePath: 'f.md',
                line: 2,
                rawText: '  - [ ] b',
                text: 'b',
                markdownText: 'b',
                status: 'open',
                statusSymbol: ' ',
                priority: 'D' as const,
              },
            ],
          }),
        ],
        resolvedConfig(),
      );
      expect(c.querySelector('.tc-task-progress')?.textContent).toBe('1/2');
    });

    it('destroy is a no-op (no throw)', () => {
      const { view } = makeView();
      expect(() => view.destroy()).not.toThrow();
    });
  });

  describe('source note chip', () => {
    it('sourceNoteDisplay never → no chip rendered', () => {
      const { view } = makeView();
      const c = freshContainer();
      const t = task({
        due: today(),
        status: 'open',
        filePath: 'Projects/alpha.md',
        dailyNoteDate: undefined,
      });
      view.render(c, [t], resolvedConfig({ sourceNoteDisplay: 'never' }));
      expect(c.querySelector('.tc-task-source-note')).toBeNull();
    });

    it('sourceNoteDisplay always → chip shows filename without extension', () => {
      const { view } = makeView();
      const c = freshContainer();
      const t = task({
        due: today(),
        status: 'open',
        filePath: 'Projects/alpha.md',
        dailyNoteDate: undefined,
      });
      view.render(c, [t], resolvedConfig({ sourceNoteDisplay: 'always' }));
      const chip = c.querySelector('.tc-task-source-note');
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toContain('alpha');
    });

    it('sourceNoteDisplay always → chip shows for daily note too', () => {
      const { view } = makeView();
      const c = freshContainer();
      const t = task({
        due: today(),
        status: 'open',
        filePath: 'periodic/daily/2026-06-25.md',
        dailyNoteDate: '2026-06-25',
      });
      view.render(c, [t], resolvedConfig({ sourceNoteDisplay: 'always' }));
      expect(c.querySelector('.tc-task-source-note')).not.toBeNull();
    });

    it('sourceNoteDisplay non-default → no chip for daily note task', () => {
      const { view } = makeView();
      const c = freshContainer();
      const t = task({
        due: today(),
        status: 'open',
        filePath: 'periodic/daily/2026-06-25.md',
        dailyNoteDate: '2026-06-25',
      });
      view.render(c, [t], resolvedConfig({ sourceNoteDisplay: 'non-default' }));
      expect(c.querySelector('.tc-task-source-note')).toBeNull();
    });

    it('sourceNoteDisplay non-default → no chip when filePath matches customFilePath', () => {
      const { view } = makeView();
      const c = freshContainer();
      const t = task({
        due: today(),
        status: 'open',
        filePath: 'Inbox/tasks.md',
        dailyNoteDate: undefined,
      });
      view.render(
        c,
        [t],
        resolvedConfig({ sourceNoteDisplay: 'non-default', customFilePath: 'Inbox/tasks.md' }),
      );
      expect(c.querySelector('.tc-task-source-note')).toBeNull();
    });

    it('sourceNoteDisplay non-default → chip shown for non-default file', () => {
      const { view } = makeView();
      const c = freshContainer();
      const t = task({
        due: today(),
        status: 'open',
        filePath: 'Projects/beta.md',
        dailyNoteDate: undefined,
      });
      view.render(c, [t], resolvedConfig({ sourceNoteDisplay: 'non-default', customFilePath: '' }));
      const chip = c.querySelector('.tc-task-source-note');
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toContain('beta');
    });

    it('chip text is just the filename without path or extension', () => {
      const { view } = makeView();
      const c = freshContainer();
      const t = task({
        due: today(),
        status: 'open',
        filePath: 'a/b/c/deep-note.md',
        dailyNoteDate: undefined,
      });
      view.render(c, [t], resolvedConfig({ sourceNoteDisplay: 'always' }));
      const chip = c.querySelector('.tc-task-source-note');
      expect(chip?.textContent).not.toContain('/');
      expect(chip?.textContent).not.toContain('.md');
      expect(chip?.textContent).toContain('deep-note');
    });

    it('chip appears before tag chip in the meta element', () => {
      const { view } = makeView();
      const c = freshContainer();
      const t = task({
        due: today(),
        status: 'open',
        filePath: 'Projects/alpha.md',
        dailyNoteDate: undefined,
        rawText: '- [ ] task #work',
      });
      view.render(c, [t], resolvedConfig({ sourceNoteDisplay: 'always' }));
      const meta = c.querySelector('.tc-list-task-meta');
      expect(meta).not.toBeNull();
      const children = Array.from(meta!.children);
      const noteIdx = children.findIndex((el) => el.classList.contains('tc-task-source-note'));
      const tagIdx = children.findIndex((el) => el.classList.contains('tc-task-tag'));
      expect(noteIdx).toBeGreaterThanOrEqual(0);
      expect(tagIdx).toBeGreaterThan(noteIdx);
    });
  });

  describe('edge cases', () => {
    it('startPosition YYYY-MM controls which month is rendered', () => {
      const { view } = makeView();
      const c = freshContainer();
      const nextMonth = window.moment().add(1, 'month').format('YYYY-MM');
      const todayStr = today();
      // a task due today (current month) should NOT appear when rendering next month
      view.render(
        c,
        [task({ due: todayStr, status: 'open' })],
        resolvedConfig({ startPosition: nextMonth }),
      );
      // today is not in next month → no day sections (overdue section may appear if due<today, but today is not <today)
      expect(c.querySelectorAll('.tc-list-section')).toHaveLength(0);
    });

    it('past-due task in rendered month appears in overdue section only (not duplicated)', () => {
      const { view } = makeView();
      const c = freshContainer();
      // Use current month so the overdue task's date falls within the rendered month
      const pastDate = window.moment().subtract(5, 'days').format('YYYY-MM-DD');
      const t = task({ due: pastDate, status: 'open' });
      view.render(c, [t], resolvedConfig());
      expect(c.querySelectorAll('.tc-list-task')).toHaveLength(1);
      expect(c.querySelector('.tc-list-overdue-header')).not.toBeNull();
    });
  });
});
