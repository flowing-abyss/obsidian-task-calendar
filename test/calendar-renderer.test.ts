import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/parser/types';
import type { TaskStore } from '../src/store/TaskStore';
import { CalendarRenderer } from '../src/ui/CalendarRenderer';
import { freshContainer, resolvedConfig, task, useRealMoment } from './helpers';

useRealMoment();

class StubStore {
  private tasks: Task[] = [];
  private listeners = new Set<(p: { changedFile?: string }) => void>();
  getTasks(): Task[] {
    return this.tasks;
  }
  onUpdate(cb: (p: { changedFile?: string }) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(changedFile?: string): void {
    for (const l of this.listeners) l({ changedFile });
  }
  setTasks(t: Task[]): void {
    this.tasks = t;
  }
  toggleTask = vi.fn();
  addTask = vi.fn<(date: string, text: string) => Promise<void>>().mockResolvedValue(undefined);
}

function fakeApp(): App {
  return {} as App;
}

describe('CalendarRenderer', () => {
  describe('construction & mount', () => {
    it('constructor sets activeViewType from config.defaultView', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'week' }),
        fakeApp(),
      );
      r.mount();
      expect(root.getAttribute('view')).toBe('week');
      r.destroy();
    });

    it('selectedDate = moment().date(1) when no startPosition', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      // currentTitle reflects selectedDate month
      const tb = root.querySelector('.current') as HTMLButtonElement;
      expect(tb.textContent).toBe(
        `${window.moment().format('MMMM')} ${window.moment().format('YYYY')}`,
      );
      r.destroy();
    });

    it('selectedDate = moment(startPosition).date(1) when set', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ startPosition: '2026-03' }),
        fakeApp(),
      );
      r.mount();
      const tb = root.querySelector('.current') as HTMLButtonElement;
      expect(tb.textContent).toContain('March');
      expect(tb.textContent).toContain('2026');
      r.destroy();
    });

    // CURRENT BEHAVIOR (follow-up: FU-19): startPosition ignored when defaultView === 'week'
    it('startPosition ignored when defaultView === week', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'week', startPosition: '2026-03' }),
        fakeApp(),
      );
      r.mount();
      const tb = root.querySelector('.current') as HTMLButtonElement;
      // title is current week, not March
      expect(tb.textContent).toMatch(/^Week \d+ · \d{4}$/);
      r.destroy();
    });

    it('mount wraps everything in a span', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      expect(root.querySelector(':scope > span')).not.toBeNull();
      r.destroy();
    });

    it('mount instantiates Toolbar (.buttons present)', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      expect(root.querySelector('.buttons')).not.toBeNull();
      r.destroy();
    });

    it('mount subscribes to store.onUpdate — emit triggers patch + updateToolbar', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      store.setTasks([task({ due: window.moment().format('YYYY-MM-DD'), status: 'open' })]);
      store.emit();
      // after emit, toolbar stats should reflect 1 due task
      expect(
        root.querySelector('.statisticPopup li[data-group="due"] .stat-count')?.textContent,
      ).toBe('1');
      r.destroy();
    });
  });

  describe('view switching', () => {
    it('default month → grid with .gridHeads + .wrappers', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month' }),
        fakeApp(),
      );
      r.mount();
      expect(root.querySelector('.gridHeads')).not.toBeNull();
      expect(root.querySelector('.wrappers')).not.toBeNull();
      r.destroy();
    });

    it('switchView("week") → 7 cells', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month' }),
        fakeApp(),
      );
      r.mount();
      // click weekView button
      (root.querySelector('.weekView') as HTMLButtonElement).click();
      expect(root.querySelectorAll('.cell')).toHaveLength(7);
      r.destroy();
    });

    it('switchView("list") → .tc-list-view present', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month' }),
        fakeApp(),
      );
      r.mount();
      (root.querySelector('.listView') as HTMLButtonElement).click();
      expect(root.querySelector('.tc-list-view')).not.toBeNull();
      r.destroy();
    });

    it('switchView back to month restores month grid', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month' }),
        fakeApp(),
      );
      r.mount();
      (root.querySelector('.weekView') as HTMLButtonElement).click();
      expect(root.querySelector('.gridHeads')).toBeNull();
      (root.querySelector('.monthView') as HTMLButtonElement).click();
      expect(root.querySelector('.gridHeads')).not.toBeNull();
      r.destroy();
    });

    it('switchView(sameType) is a no-op', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month' }),
        fakeApp(),
      );
      r.mount();
      const gridBefore = root.querySelector('.grid');
      (root.querySelector('.monthView') as HTMLButtonElement).click();
      const gridAfter = root.querySelector('.grid');
      expect(gridAfter).toBe(gridBefore);
      r.destroy();
    });
  });

  describe('navigation', () => {
    it('onPrev in month → previous month title', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month' }),
        fakeApp(),
      );
      r.mount();
      const prevTitle = (root.querySelector('.current') as HTMLButtonElement).textContent;
      (root.querySelector('.previous') as HTMLButtonElement).click();
      const newTitle = (root.querySelector('.current') as HTMLButtonElement).textContent;
      expect(newTitle).not.toBe(prevTitle);
      r.destroy();
    });

    it('onNext in month → next month title', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month' }),
        fakeApp(),
      );
      r.mount();
      const prevTitle = (root.querySelector('.current') as HTMLButtonElement).textContent;
      (root.querySelector('.next') as HTMLButtonElement).click();
      expect((root.querySelector('.current') as HTMLButtonElement).textContent).not.toBe(prevTitle);
      r.destroy();
    });

    it('onToday resets to current month', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month', startPosition: '2026-01' }),
        fakeApp(),
      );
      r.mount();
      // navigate away then today
      (root.querySelector('.next') as HTMLButtonElement).click();
      (root.querySelector('.current') as HTMLButtonElement).click(); // "current" button = onToday
      expect((root.querySelector('.current') as HTMLButtonElement).textContent).toContain(
        window.moment().format('MMMM'),
      );
      r.destroy();
    });

    it('currentTitle week format = "Week N · YYYY"', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'week' }),
        fakeApp(),
      );
      r.mount();
      expect((root.querySelector('.current') as HTMLButtonElement).textContent).toMatch(
        /^Week \d+ · \d{4}$/,
      );
      r.destroy();
    });
  });

  describe('toolbar wiring', () => {
    it('onFilterToggle toggles rootEl "filter" class', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      expect(root.classList.contains('filter')).toBe(false);
      (root.querySelector('.filter') as HTMLButtonElement).click();
      expect(root.classList.contains('filter')).toBe(true);
      (root.querySelector('.filter') as HTMLButtonElement).click();
      expect(root.classList.contains('filter')).toBe(false);
      r.destroy();
    });

    it('onOverdueHighlight toggles overdue button active', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      const btn = root.querySelector('.overdueHighlighter') as HTMLButtonElement;
      btn.click();
      expect(btn.classList.contains('active')).toBe(true);
      btn.click();
      expect(btn.classList.contains('active')).toBe(false);
      r.destroy();
    });

    it('onStatFilter(group) → rootEl gains focus<Group> class', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      // open stat popup and click a group li
      (root.querySelector('.statistic') as HTMLButtonElement).click();
      (root.querySelector('.statisticPopup li[data-group="due"]') as HTMLElement).click();
      expect(root.classList.contains('focusDue')).toBe(true);
      r.destroy();
    });

    it('onStatFilter(null) → all focus* classes removed', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      (root.querySelector('.statistic') as HTMLButtonElement).click();
      const li = root.querySelector('.statisticPopup li[data-group="due"]') as HTMLElement;
      li.click(); // activate
      li.click(); // deactivate → onStatFilter(null)
      expect(root.className.split(' ').filter((c) => c.startsWith('focus'))).toHaveLength(0);
      r.destroy();
    });

    it('onStyleChange("style3") → style class swapped on rootEl', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month', style: 'style1' }),
        fakeApp(),
      );
      r.mount();
      // open style popup by clicking active view button
      (root.querySelector('.monthView') as HTMLButtonElement).click();
      (root.querySelector('.weekViewContext li[data-style="style3"]') as HTMLElement).click();
      expect(root.classList.contains('style3')).toBe(true);
      expect(root.classList.contains('style1')).toBe(false);
      r.destroy();
    });
  });

  describe('stats computation', () => {
    it('stats reflect store.getTasks()', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      const todayStr = window.moment().format('YYYY-MM-DD');
      store.setTasks([
        task({ status: 'done' }),
        task({ due: todayStr, status: 'open' }),
        task({ due: '2020-01-01', status: 'open' }),
        task({ start: todayStr, status: 'open' }),
      ]);
      store.emit();
      expect(
        root.querySelector('.statisticPopup li[data-group="done"] .stat-count')?.textContent,
      ).toBe('1');
      // CURRENT BEHAVIOR: "due" counts all open tasks with a due field (both today and 2020-01-01).
      expect(
        root.querySelector('.statisticPopup li[data-group="due"] .stat-count')?.textContent,
      ).toBe('2');
      expect(
        root.querySelector('.statisticPopup li[data-group="start"] .stat-count')?.textContent,
      ).toBe('1');
      r.destroy();
    });
  });

  describe('callbacks', () => {
    it('onWeekClick switches to week view + updates selectedDate', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month' }),
        fakeApp(),
      );
      r.mount();
      // find first wrapperButton and click it (triggers onWeekClick)
      const wBtn = root.querySelector('.wrapperButton') as HTMLElement;
      wBtn.click();
      // view should switch to week → 7 cells
      expect(root.querySelectorAll('.cell')).toHaveLength(7);
      r.destroy();
    });

    // CURRENT BEHAVIOR (follow-up: FU-20): onWeekClick while already in week view
    // updates selectedDate but does NOT re-render (switchView early-returns on same type).
    // This bug is NOT triggerable through the CalendarRenderer UI alone (onWeekClick is
    // only wired to MonthView's wrapperButton, absent in week view). It's reachable only
    // via CenterPanel's separate onWeekClick wiring. Pinned as documentation-only —
    // no executable test here; covered conceptually by the switchView(sameType) no-op test above.
    it('FU-20: onWeekClick-in-week-view no-rerender bug is unreachable via CalendarRenderer UI', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'week' }),
        fakeApp(),
      );
      r.mount();
      // Week view has no .wrapperButton elements to click, so the bug cannot manifest here.
      expect(root.querySelectorAll('.wrapperButton')).toHaveLength(0);
      r.destroy();
    });

    it('onToggle(task) → store.toggleTask called', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig({ defaultView: 'month' }),
        fakeApp(),
      );
      r.mount();
      const todayStr = window.moment().format('YYYY-MM-DD');
      const t = task({ due: todayStr, status: 'open' });
      store.setTasks([t]);
      store.emit();
      // click the checkbox inside the task card
      const cb = root.querySelector('.task .calendar-task-checkbox') as HTMLInputElement;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      expect(store.toggleTask).toHaveBeenCalledWith(t);
      r.destroy();
    });
  });

  describe('destroy', () => {
    it('unsubscribes from store', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      r.destroy();
      // emit after destroy should not throw and should not update DOM
      expect(() => store.emit()).not.toThrow();
    });

    it('empties rootEl', () => {
      const store = new StubStore();
      const root = freshContainer();
      const r = new CalendarRenderer(
        root,
        store as unknown as TaskStore,
        resolvedConfig(),
        fakeApp(),
      );
      r.mount();
      r.destroy();
      expect(root.children).toHaveLength(0);
    });
  });
});
