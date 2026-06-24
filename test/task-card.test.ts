import { describe, expect, it, vi } from 'vitest';
import { createTaskCard } from '../src/ui/TaskCard';
import type { Task } from '../src/parser/types';
import { task, useRealMoment, withMobile } from './helpers';

useRealMoment();

describe('createTaskCard', () => {
  describe('color styling (transColor via style attribute)', () => {
    it('noteColor only: derives dark/light via transColor (pinned values)', () => {
      const el = createTaskCard(task({ noteColor: '#3a3a3a' }), 'due');
      const style = el.getAttribute('style');
      expect(style).toBe(
        '--task-background:#3a3a3a33;--task-color:#3a3a3a;--dark-task-text-color:#000000;--light-task-text-color:#7a7a7a',
      );
    });

    it('noteTextColor only: gray background, text colors via transColor of noteTextColor', () => {
      const el = createTaskCard(task({ noteTextColor: '#ff8800' }), 'due');
      expect(el.getAttribute('style')).toBe(
        '--task-background:#7D7D7D33;--task-color:#7D7D7D;--dark-task-text-color:#992200;--light-task-text-color:#ffc840',
      );
    });

    it('both noteColor and noteTextColor: text colors set directly, no transColor call', () => {
      const el = createTaskCard(
        task({ noteColor: '#abcdef', noteTextColor: '#123456' }),
        'due',
      );
      expect(el.getAttribute('style')).toBe(
        '--task-background:#abcdef33;--task-color:#abcdef;--dark-task-text-color:#123456;--light-task-text-color:#123456',
      );
    });

    it('neither: fixed defaults', () => {
      const el = createTaskCard(task(), 'due');
      expect(el.getAttribute('style')).toBe(
        '--task-background:#7D7D7D33;--task-color:#7D7D7D;--dark-task-text-color:#4d4d4d;--light-task-text-color:#a8a8a8',
      );
    });
  });

  describe('DOM structure', () => {
    it('returns an HTMLElement', () => {
      const el = createTaskCard(task(), 'due');
      expect(el).toBeInstanceOf(HTMLElement);
    });

    it('root div has class "task {cls} noNoteIcon" when no noteIcon', () => {
      const el = createTaskCard(task(), 'due');
      expect(el.className).toBe('task due noNoteIcon');
    });

    it('root div has class "task {cls}" (no noNoteIcon) when noteIcon present', () => {
      const el = createTaskCard(task({ noteIcon: '🔵' }), 'due');
      expect(el.className).toBe('task due');
    });

    it('sets data-task-text and title to task.text', () => {
      const el = createTaskCard(task({ text: 'Buy milk' }), 'due');
      expect(el.getAttribute('data-task-text')).toBe('Buy milk');
      expect(el.getAttribute('title')).toBe('Buy milk');
    });

    it('sets data-due iff task.due', () => {
      expect(createTaskCard(task({ due: '2026-06-24' }), 'due').getAttribute('data-due')).toBe(
        '2026-06-24',
      );
      expect(createTaskCard(task(), 'due').getAttribute('data-due')).toBeNull();
    });
  });

  describe('checkbox (default mode)', () => {
    it('renders a checkbox in default mode, checked iff status === done', () => {
      expect(
        createTaskCard(task({ status: 'open' }), 'due').querySelector(
          'input.calendar-task-checkbox',
        )?.checked,
      ).toBe(false);
      expect(
        createTaskCard(task({ status: 'done' }), 'due').querySelector(
          'input.calendar-task-checkbox',
        )?.checked,
      ).toBe(true);
    });

    it('omits the checkbox in timeblock mode', () => {
      const el = createTaskCard(task(), 'due', { mode: 'timeblock' });
      expect(el.querySelector('input.calendar-task-checkbox')).toBeNull();
    });

    it('invokes onToggle once on change', () => {
      const onToggle = vi.fn();
      const el = createTaskCard(task({ text: 'x' }), 'due', { onToggle });
      const cb = el.querySelector('input.calendar-task-checkbox') as HTMLInputElement;
      cb.dispatchEvent(new Event('change'));
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onToggle.mock.calls[0]?.[0]?.text).toBe('x');
    });
  });

  describe('internal link', () => {
    it('href is the file path with .md stripped', () => {
      expect(
        createTaskCard(task({ filePath: 'notes/x.md' }), 'due').querySelector(
          'a.internal-link',
        )?.getAttribute('href'),
      ).toBe('notes/x');
      expect(
        createTaskCard(task({ filePath: 'notes/x' }), 'due').querySelector(
          'a.internal-link',
        )?.getAttribute('href'),
      ).toBe('notes/x');
    });
  });

  describe('icon', () => {
    it('maps each known taskClass to its icon', () => {
      const expected: Record<string, string> = {
        done: '✅',
        due: '📅',
        scheduled: '⏳',
        recurrence: '🔁',
        overdue: '⚠️',
        process: '⏺️',
        cancelled: '🚫',
        start: '🛫',
        dailyNote: '📄',
      };
      for (const [cls, icon] of Object.entries(expected)) {
        const el = createTaskCard(task(), cls);
        expect(el.querySelector('.icon')?.textContent).toBe(icon);
      }
    });

    it('uses empty string for an unknown taskClass', () => {
      const el = createTaskCard(task(), 'unknownClass');
      expect(el.querySelector('.icon')?.textContent).toBe('');
    });
  });

  describe('data-relative', () => {
    it('populates data-relative from window.moment(due).fromNow() when due', () => {
      vi.useFakeTimers({ now: new Date('2026-06-24T10:00:00Z').getTime() });
      const el = createTaskCard(task({ due: '2026-06-24' }), 'due');
      // exact phrasing depends on locale/timezone; assert it is non-empty
      expect(el.querySelector('.description')?.dataset.relative).toBeTruthy();
      vi.useRealTimers();
    });

    it('sets data-relative to empty string when no due', () => {
      const el = createTaskCard(task(), 'due');
      expect(el.querySelector('.description')?.dataset.relative).toBe('');
    });
  });

  describe('mobile long-press', () => {
    withMobile(true);

    it('attaches long-press and sets userSelect styles', () => {
      const el = createTaskCard(task(), 'due');
      expect(el.style.userSelect).toBe('none');
      expect(el.style.webkitUserSelect).toBe('none');
      expect(el.style.touchAction).toBe('manipulation');
    });
  });
});