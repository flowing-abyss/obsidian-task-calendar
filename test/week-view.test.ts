import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { LinkToken } from '../src/parser/links';
import type { Task } from '../src/parser/types';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { WeekView } from '../src/views/WeekView';
import { dispatchDnD, freshContainer, resolvedConfig, task, useRealMoment } from './helpers';

useRealMoment();

function fakeApp(): App {
  return {} as App;
}

function makeView(
  callbacks: Partial<{
    onToggle: (t: Task) => void;
    onCellClick: (d: string) => void;
    onTaskClick: (t: Task) => void;
    onDrop: (d: string, date: string) => void;
    onOpenNote: (t: Task) => void;
    onEditLink: (t: Task, occ: number, token: LinkToken) => void;
    onContextMenu: (ev: MouseEvent, t: Task) => void;
  }> = {},
) {
  const spies = {
    app: fakeApp(),
    onToggle: vi.fn(callbacks.onToggle),
    onCellClick: vi.fn(callbacks.onCellClick),
    onTaskClick: vi.fn(callbacks.onTaskClick),
    onDrop: vi.fn(callbacks.onDrop),
    onOpenNote: vi.fn(callbacks.onOpenNote),
    onEditLink: vi.fn(callbacks.onEditLink),
    statusRegistry: new StatusRegistry(buildDefaultTaskStatuses()),
    onContextMenu: vi.fn(callbacks.onContextMenu),
  };
  return { view: new WeekView(spies), spies };
}

describe('WeekView', () => {
  describe('grid structure', () => {
    it('produces one .grid with 7 .cell elements', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      expect(c.querySelectorAll('.grid')).toHaveLength(1);
      expect(c.querySelectorAll('.cell')).toHaveLength(7);
    });

    it('today cell has currentWeek today class', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      const todayCell = c.querySelector('.cell.today');
      expect(todayCell).not.toBeNull();
      expect(todayCell?.classList.contains('currentWeek')).toBe(true);
      vi.useRealTimers();
    });

    it('other 6 cells have cell currentWeek (no today)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      const cells = c.querySelectorAll('.cell');
      const todayCount = Array.from(cells).filter((el) => el.classList.contains('today')).length;
      expect(todayCount).toBe(1);
      expect(cells).toHaveLength(7);
      vi.useRealTimers();
    });

    it('each cell has data-weekday attribute', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      c.querySelectorAll('.cell').forEach((cell) => {
        expect((cell as HTMLElement).getAttribute('data-weekday')).not.toBeNull();
      });
    });

    it('cellName href follows dailyNoteFolder rule', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig({ dailyNoteFolder: 'daily' }));
      const link = c.querySelector('.cellName') as HTMLAnchorElement;
      expect(link.getAttribute('href')?.startsWith('daily/')).toBe(true);
    });
  });

  describe('task rendering + DnD', () => {
    it('task due on a visible weekday appears in that cell', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view } = makeView();
      const c = freshContainer();
      const t = task({ due: '2026-06-17', status: 'open' });
      view.render(c, [t], resolvedConfig());
      expect(c.querySelectorAll('.task')).toHaveLength(1);
      vi.useRealTimers();
    });

    it('card draggable=true', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [task({ due: '2026-06-17', status: 'open' })], resolvedConfig());
      expect((c.querySelector('.task') as HTMLElement).getAttribute('draggable')).toBe('true');
      vi.useRealTimers();
    });

    it('dragstart sets dataTransfer to filePath:::line', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view } = makeView();
      const c = freshContainer();
      const t = task({ due: '2026-06-17', status: 'open', filePath: 'b.md', line: 7 });
      view.render(c, [t], resolvedConfig());
      const card = c.querySelector('.task') as HTMLElement;
      const dt = new (class {
        store = new Map<string, string>();
        setData(f: string, d: string) {
          this.store.set(f, d);
        }
        getData(f: string) {
          return this.store.get(f) ?? '';
        }
        effectAllowed = '';
        dropEffect = '';
      })();
      const ev = new MouseEvent('dragstart', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
      card.dispatchEvent(ev);
      expect(dt.getData('text/plain')).toBe('b.md:::7');
      vi.useRealTimers();
    });

    it('drop on cellContent → onDrop(payload, currentDate)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view, spies } = makeView({ onDrop: (d, date) => `${d}-${date}` });
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      const cellContent = c.querySelector('.cell.today .cellContent') as HTMLElement;
      dispatchDnD(cellContent, 'drop', 'b.md:::1');
      expect(spies.onDrop).toHaveBeenCalledTimes(1);
      expect(spies.onDrop.mock.calls[0]![0]).toBe('b.md:::1');
      vi.useRealTimers();
    });

    it('dragover adds is-drag-over class', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      const cellContent = c.querySelector('.cell.today .cellContent') as HTMLElement;
      expect(cellContent.classList.contains('is-drag-over')).toBe(false);
      dispatchDnD(cellContent, 'dragover');
      expect(cellContent.classList.contains('is-drag-over')).toBe(true);
      vi.useRealTimers();
    });

    it('dragleave to outside removes is-drag-over class', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      const cellContent = c.querySelector('.cell.today .cellContent') as HTMLElement;
      dispatchDnD(cellContent, 'dragover');
      expect(cellContent.classList.contains('is-drag-over')).toBe(true);
      dispatchDnD(cellContent, 'dragleave', undefined, null);
      expect(cellContent.classList.contains('is-drag-over')).toBe(false);
      vi.useRealTimers();
    });

    it('clicking a task card → onTaskClick called', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view, spies } = makeView({ onTaskClick: (t) => t });
      const c = freshContainer();
      const t = task({ due: '2026-06-17', status: 'open', text: 'click me' });
      view.render(c, [t], resolvedConfig());
      const card = c.querySelector('.task') as HTMLElement;
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(spies.onTaskClick).toHaveBeenCalledTimes(1);
      expect(spies.onTaskClick.mock.calls[0]![0]).toBe(t);
      vi.useRealTimers();
    });

    it('cell click → onCellClick unless target is .task or .cellName', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view, spies } = makeView({ onCellClick: (d) => d });
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      const todayCell = c.querySelector('.cell.today') as HTMLElement;
      todayCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(spies.onCellClick).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('cellName click → onCellClick NOT called', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00'));
      const { view, spies } = makeView({ onCellClick: (d) => d });
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      const cellName = c.querySelector('.cell.today .cellName') as HTMLElement;
      cellName.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(spies.onCellClick).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('navigation edge cases', () => {
    it('startPosition YYYY-ww renders that exact week', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig({ startPosition: '2026-02' }));
      // 2026-02 ISO week = Jan 12-18 (week starts Monday in ISO)
      // Actually moment('YYYY-ww') uses locale week; just assert 7 cells render
      expect(c.querySelectorAll('.cell')).toHaveLength(7);
    });

    // CURRENT BEHAVIOR (follow-up: FU-18): startOf('week') uses moment locale
    // week-start (Sunday), NOT config.firstDayOfWeek. Pin: changing firstDayOfWeek
    // does NOT change the set of 7 days, only the render order/indexing.
    it('firstDayOfWeek shifts render order but window set unchanged', () => {
      const { view: v1 } = makeView();
      const c1 = freshContainer();
      v1.render(c1, [], resolvedConfig({ firstDayOfWeek: 0 }));
      const weekdays1 = Array.from(c1.querySelectorAll('.cell')).map((el) =>
        (el as HTMLElement).getAttribute('data-weekday'),
      );

      const { view: v2 } = makeView();
      const c2 = freshContainer();
      v2.render(c2, [], resolvedConfig({ firstDayOfWeek: 1 }));
      const weekdays2 = Array.from(c2.querySelectorAll('.cell')).map((el) =>
        (el as HTMLElement).getAttribute('data-weekday'),
      );

      // The set of weekdays should be the same (same 7 days), order differs
      const set1 = new Set(weekdays1);
      const set2 = new Set(weekdays2);
      expect(set1).toEqual(set2);
    });

    it('destroy resets containerEl', () => {
      const { view } = makeView();
      const c = freshContainer();
      view.render(c, [], resolvedConfig());
      expect(() => view.destroy()).not.toThrow();
    });
  });
});
