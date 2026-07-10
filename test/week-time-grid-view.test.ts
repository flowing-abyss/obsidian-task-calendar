import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { WeekTimeGridView } from '../src/views/WeekTimeGridView';
import { freshContainer, resolvedConfig, task, useRealMoment } from './helpers';

useRealMoment();
const fakeApp = {} as App;
const registry = new StatusRegistry(buildDefaultTaskStatuses());

function callbacks() {
  return {
    app: fakeApp,
    onTaskClick: vi.fn(),
    onDrop: vi.fn(),
    onDropTime: vi.fn(),
    onCreateAtTime: vi.fn(),
    onDayHeaderClick: vi.fn(),
    onTimeChange: vi.fn(),
    onDurationChange: vi.fn(),
    onStartChange: vi.fn(),
    onDueChange: vi.fn(),
    onExtendToSpan: vi.fn(),
    onToggle: vi.fn(),
    onSetStatus: vi.fn(),
    onSetPriority: vi.fn(),
    statusRegistry: registry,
  };
}

describe('WeekTimeGridView', () => {
  it('renders 7 day columns for the week containing startPosition', () => {
    const container = freshContainer();
    const view = new WeekTimeGridView(callbacks());
    // 2026-07-06 is a Monday; ISO week 28 of 2026
    view.render(container, [], resolvedConfig({ startPosition: '2026-28', firstDayOfWeek: 1 }));
    expect(container.querySelectorAll('.tc-tg-day-column')).toHaveLength(7);
  });

  it('threads onDropTime through to each day column, firing on drop', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new WeekTimeGridView(cbs);
    view.render(container, [], resolvedConfig({ startPosition: '2026-28', firstDayOfWeek: 1 }));
    const hourColumnEl = container.querySelectorAll('.tc-tg-hour-column')[0] as HTMLElement;
    const dt = { getData: () => 'f.md:::0' } as unknown as DataTransfer;
    const ev = new MouseEvent('drop', { bubbles: true, clientY: 148 });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    hourColumnEl.dispatchEvent(ev);
    expect(cbs.onDropTime).toHaveBeenCalledWith('f.md:::0', expect.any(String), expect.any(String));
  });

  it("threads onDayHeaderClick through to each header cell, firing with that column's date", () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new WeekTimeGridView(cbs);
    view.render(container, [], resolvedConfig({ startPosition: '2026-28', firstDayOfWeek: 1 }));
    const headerCells = Array.from(container.querySelectorAll('.tc-tg-header-cell'));
    expect(headerCells).toHaveLength(7);
    const dates = Array.from(container.querySelectorAll('.tc-tg-day-column')).map((el) =>
      el.getAttribute('data-tg-date'),
    );
    (headerCells[2] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onDayHeaderClick).toHaveBeenCalledWith(dates[2]);
  });

  it('places a timed task in the correct day column within the week', () => {
    const container = freshContainer();
    const view = new WeekTimeGridView(callbacks());
    const t = task({ due: '2026-07-08', time: '10:00' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-28', firstDayOfWeek: 1 }));
    expect(container.querySelectorAll('.tc-tg-block')).toHaveLength(1);
  });

  it('a span crossing multiple days in the week renders a body in each covered day cell', () => {
    const container = freshContainer();
    const view = new WeekTimeGridView(callbacks());
    const t = task({ start: '2026-07-07', due: '2026-07-09' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-28', firstDayOfWeek: 1 }));
    expect(container.querySelectorAll('.tc-tg-span')).toHaveLength(3);
  });

  it('destroy() does not throw', () => {
    const view = new WeekTimeGridView(callbacks());
    expect(() => view.destroy()).not.toThrow();
  });

  it('periodically repositions the now-line while the mounted week includes today, and clears the interval on destroy', () => {
    vi.useFakeTimers();
    try {
      const container = freshContainer();
      const view = new WeekTimeGridView(callbacks());
      const todayWeek = window.moment().format('YYYY-ww');
      view.render(container, [], resolvedConfig({ startPosition: todayWeek, firstDayOfWeek: 1 }));

      const nowLineEl = container.querySelector('.tc-tg-now-line') as HTMLElement;
      expect(nowLineEl).not.toBeNull();
      const initialTop = nowLineEl.style.top;

      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

      vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(nowLineEl.style.top).not.toBe(initialTop);

      view.destroy();
      expect(clearIntervalSpy).toHaveBeenCalled();

      const topAfterDestroy = nowLineEl.style.top;
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(nowLineEl.style.top).toBe(topAfterDestroy);

      clearIntervalSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-rendering without an intervening destroy() clears the previous interval instead of stacking a second one', () => {
    vi.useFakeTimers();
    try {
      const container = freshContainer();
      const view = new WeekTimeGridView(callbacks());
      const todayWeek = window.moment().format('YYYY-ww');

      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
      const setIntervalSpy = vi.spyOn(window, 'setInterval');

      view.render(container, [], resolvedConfig({ startPosition: todayWeek, firstDayOfWeek: 1 }));
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      view.render(container, [], resolvedConfig({ startPosition: todayWeek, firstDayOfWeek: 1 }));
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);

      view.destroy();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a timed block title via renderTaskText (markdown-link-aware) for a task with a [[wikilink]]', () => {
    const container = freshContainer();
    const view = new WeekTimeGridView(callbacks());
    const t = task({
      due: '2026-07-08',
      time: '10:00',
      text: 'see [[Note]]',
      markdownText: 'see [[Note]]',
    });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-28', firstDayOfWeek: 1 }));
    const title = container.querySelector('.tc-tg-block-title') as HTMLElement;
    expect(title.querySelector('.tc-md')).not.toBeNull();
  });

  it('clicking the status marker on a timed block fires onToggle, not onTaskClick (threaded through WeekTimeGridView)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new WeekTimeGridView(cbs);
    const t = task({ due: '2026-07-08', time: '10:00' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-28', firstDayOfWeek: 1 }));
    const marker = container.querySelector('.tc-tg-block .tc-status-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('auto-scrolls the grid row to center the now-line when the rendered week contains today', () => {
    vi.useFakeTimers();
    // 2026-06-15 is a Monday within ISO week 25 of 2026, at 14:30
    vi.setSystemTime(new Date('2026-06-15T14:30:00'));
    const container = freshContainer();
    const view = new WeekTimeGridView(callbacks());
    view.render(container, [], resolvedConfig({ startPosition: '2026-25', firstDayOfWeek: 1 }));
    const gridRowEl = container.querySelector('.tc-tg-grid-row') as HTMLElement;
    Object.defineProperty(gridRowEl, 'clientHeight', { value: 400, configurable: true });
    expect(gridRowEl.scrollTop).toBe(0);
    // Use runOnlyPendingTimers, not runAllTimers: render() now also registers a repeating
    // now-line-refresh interval, and runAllTimers would loop on it forever.
    vi.runOnlyPendingTimers();
    expect(gridRowEl.scrollTop).toBe(496);
    vi.useRealTimers();
  });

  it('does not auto-scroll when today is not in the rendered week', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T14:30:00'));
    const container = freshContainer();
    const view = new WeekTimeGridView(callbacks());
    // 2026-28 is a different week than the current system time's week
    view.render(container, [], resolvedConfig({ startPosition: '2026-28', firstDayOfWeek: 1 }));
    const gridRowEl = container.querySelector('.tc-tg-grid-row') as HTMLElement;
    Object.defineProperty(gridRowEl, 'clientHeight', { value: 400, configurable: true });
    vi.runAllTimers();
    expect(gridRowEl.scrollTop).toBe(0);
    vi.useRealTimers();
  });
});
