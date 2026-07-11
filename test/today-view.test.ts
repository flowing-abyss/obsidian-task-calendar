import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { bucketTasksForDate, TodayView } from '../src/views/TodayView';
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

describe('TodayView', () => {
  it('renders a timed task in the hour grid for the configured day', () => {
    const container = freshContainer();
    const view = new TodayView(callbacks());
    const t = task({ due: '2026-07-10', time: '15:00', duration: 60 });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07-10' }));
    expect(container.querySelector('.tc-tg-block')).not.toBeNull();
  });

  it('threads onDropTime through to the hour-grid column, firing on drop', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new TodayView(cbs);
    view.render(container, [], resolvedConfig({ startPosition: '2026-07-10' }));
    const hourColumnEl = container.querySelector('.tc-tg-hour-column') as HTMLElement;
    const dt = { getData: () => 'f.md:::0' } as unknown as DataTransfer;
    const ev = new MouseEvent('drop', { bubbles: true, clientY: 148 });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    hourColumnEl.dispatchEvent(ev);
    expect(cbs.onDropTime).toHaveBeenCalledWith('f.md:::0', '2026-07-10', expect.any(String));
  });

  it('renders a plain due-only task in the all-day band, not the hour grid', () => {
    const container = freshContainer();
    const view = new TodayView(callbacks());
    const t = task({ due: '2026-07-10' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07-10' }));
    expect(container.querySelector('.tc-tg-plain')).not.toBeNull();
    expect(container.querySelector('.tc-tg-block')).toBeNull();
  });

  it('renders a scheduled+due task as a plain body on its scheduled day, and a deadline marker on due day (not shown here since due != this day)', () => {
    const container = freshContainer();
    const view = new TodayView(callbacks());
    const t = task({ due: '2026-07-15', scheduled: '2026-07-10' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07-10' }));
    expect(container.querySelector('.tc-tg-plain')).not.toBeNull();
    expect(container.querySelector('.tc-tg-deadline-marker')).toBeNull();
  });

  it('a task not anchored to the configured day is excluded entirely', () => {
    const container = freshContainer();
    const view = new TodayView(callbacks());
    const t = task({ due: '2026-08-01' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07-10' }));
    expect(container.querySelector('.tc-tg-plain')).toBeNull();
  });

  it('destroy() does not throw', () => {
    const view = new TodayView(callbacks());
    expect(() => view.destroy()).not.toThrow();
  });

  it('periodically repositions the now-line while mounted on today, and clears the interval on destroy', () => {
    vi.useFakeTimers();
    try {
      const container = freshContainer();
      const view = new TodayView(callbacks());
      const today = window.moment().format('YYYY-MM-DD');
      view.render(container, [], resolvedConfig({ startPosition: today }));

      const nowLineEl = container.querySelector('.tc-tg-now-line') as HTMLElement;
      expect(nowLineEl).not.toBeNull();
      const initialTop = nowLineEl.style.top;

      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

      // Advance real+fake clock together by moving forward 2 hours, then let the 5-minute
      // interval fire; the now-line's `top` should change to reflect the new time.
      vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(nowLineEl.style.top).not.toBe(initialTop);

      view.destroy();
      expect(clearIntervalSpy).toHaveBeenCalled();

      // A destroyed view's interval must not still be running: further time advancement
      // must not throw and must not keep moving the (now-detached) now-line.
      const topAfterDestroy = nowLineEl.style.top;
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(nowLineEl.style.top).toBe(topAfterDestroy);

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-rendering without an intervening destroy() clears the previous interval instead of stacking a second one', () => {
    vi.useFakeTimers();
    try {
      const container = freshContainer();
      const view = new TodayView(callbacks());
      const today = window.moment().format('YYYY-MM-DD');

      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
      const setIntervalSpy = vi.spyOn(window, 'setInterval');

      view.render(container, [], resolvedConfig({ startPosition: today }));
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      view.render(container, [], resolvedConfig({ startPosition: today }));
      // The stale interval from the first render must be cleared before/when the second
      // render registers its own, so at most one interval is ever live at a time.
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);

      view.destroy();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicking the status marker on a timed block fires onToggle, not onTaskClick (threaded through TodayView)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new TodayView(cbs);
    const t = task({ due: '2026-07-10', time: '15:00', duration: 60 });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07-10' }));
    const marker = container.querySelector('.tc-tg-block .tc-status-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('clicking the status marker on a plain all-day chip fires onToggle, not onTaskClick (threaded through TodayView)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new TodayView(cbs);
    const t = task({ due: '2026-07-10' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07-10' }));
    const marker = container.querySelector('.tc-tg-plain .tc-status-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('renders a timed block title via renderTaskText (markdown-link-aware) for a task with a [[wikilink]]', () => {
    const container = freshContainer();
    const view = new TodayView(callbacks());
    const t = task({
      due: '2026-07-10',
      time: '15:00',
      duration: 60,
      text: 'see [[Note]]',
      markdownText: 'see [[Note]]',
    });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07-10' }));
    const title = container.querySelector('.tc-tg-block-title') as HTMLElement;
    // MarkdownRenderer is a noop in this test harness (see test/center-panel-integration.test.ts
    // and friends); `.tc-md` is the reliable signal that renderTaskText's markdown path (not a
    // raw textContent assignment) was taken.
    expect(title.querySelector('.tc-md')).not.toBeNull();
  });

  it('a second render() call does not leak the previous Component (unload/reload lifecycle mirrors legacy MonthView)', () => {
    const container = freshContainer();
    const view = new TodayView(callbacks());
    const t = task({ due: '2026-07-10', time: '15:00', duration: 60 });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07-10' }));
    expect(() =>
      view.render(container, [t], resolvedConfig({ startPosition: '2026-07-10' })),
    ).not.toThrow();
  });

  it('a task with start+due+distinct scheduled lands in spans (not deadlines) on its due day', () => {
    const t = task({ start: '2026-07-01', due: '2026-07-05', scheduled: '2026-07-03' });
    const { spans, deadlines } = bucketTasksForDate([t], '2026-07-05');
    expect(spans).toContain(t);
    expect(deadlines).not.toContain(t);
  });

  it('renders only a span bar, not a deadline marker, for a start+due+distinct-scheduled task on its due day', () => {
    const container = freshContainer();
    const view = new TodayView(callbacks());
    const t = task({ start: '2026-07-01', due: '2026-07-05', scheduled: '2026-07-03' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07-05' }));
    expect(container.querySelector('.tc-tg-span')).not.toBeNull();
    expect(container.querySelector('.tc-tg-deadline-marker')).toBeNull();
  });

  describe('timed multi-day spans (Task 29)', () => {
    it('a start+due task with a time set lands in timedSpans, not the untimed spans bucket', () => {
      const t = task({ start: '2026-07-01', due: '2026-07-03', time: '09:00' });
      const { spans, timedSpans } = bucketTasksForDate([t], '2026-07-02');
      expect(timedSpans).toContain(t);
      expect(spans).not.toContain(t);
    });

    it('an untimed start+due task still lands in spans, not timedSpans', () => {
      const t = task({ start: '2026-07-01', due: '2026-07-03' });
      const { spans, timedSpans } = bucketTasksForDate([t], '2026-07-02');
      expect(spans).toContain(t);
      expect(timedSpans).not.toContain(t);
    });

    it('a timed span is present in timedSpans on every day from start to due inclusive', () => {
      const t = task({ start: '2026-07-01', due: '2026-07-03', time: '09:00' });
      expect(bucketTasksForDate([t], '2026-07-01').timedSpans).toContain(t);
      expect(bucketTasksForDate([t], '2026-07-02').timedSpans).toContain(t);
      expect(bucketTasksForDate([t], '2026-07-03').timedSpans).toContain(t);
      expect(bucketTasksForDate([t], '2026-06-30').timedSpans).not.toContain(t);
    });

    it('a done/cancelled timed span is excluded from timedSpans', () => {
      const t = task({ start: '2026-07-01', due: '2026-07-03', time: '09:00', status: 'done' });
      const { timedSpans } = bucketTasksForDate([t], '2026-07-02');
      expect(timedSpans).not.toContain(t);
    });
  });

  it('auto-scrolls the grid row to center the now-line when the rendered day is today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T14:30:00'));
    const container = freshContainer();
    const view = new TodayView(callbacks());
    view.render(container, [], resolvedConfig());
    const gridRowEl = container.querySelector('.tc-tg-grid-row') as HTMLElement;
    Object.defineProperty(gridRowEl, 'clientHeight', { value: 400, configurable: true });
    expect(gridRowEl.scrollTop).toBe(0);
    // Use runOnlyPendingTimers, not runAllTimers: render() now also registers a repeating
    // now-line-refresh interval, and runAllTimers would loop on it forever.
    vi.runOnlyPendingTimers();
    // 14:30 = 870 minutes -> 696px at 48px/hour; centered in a 400px viewport -> 696 - 200 = 496
    expect(gridRowEl.scrollTop).toBe(496);
    vi.useRealTimers();
  });

  it('does not auto-scroll when shouldScrollToNow=false (Task 27: CenterPanel-driven dedup for reactive re-renders)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T14:30:00'));
    const container = freshContainer();
    const view = new TodayView(callbacks());
    view.render(container, [], resolvedConfig(), false);
    const gridRowEl = container.querySelector('.tc-tg-grid-row') as HTMLElement;
    Object.defineProperty(gridRowEl, 'clientHeight', { value: 400, configurable: true });
    vi.runOnlyPendingTimers();
    expect(gridRowEl.scrollTop).toBe(0);
    vi.useRealTimers();
  });

  it('shouldScrollToNow=false still registers the periodic now-line-repositioning interval (Round 2 Task 16 unaffected)', () => {
    vi.useFakeTimers();
    try {
      const container = freshContainer();
      const view = new TodayView(callbacks());
      const today = window.moment().format('YYYY-MM-DD');
      const setIntervalSpy = vi.spyOn(window, 'setInterval');

      view.render(container, [], resolvedConfig({ startPosition: today }), false);
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      const nowLineEl = container.querySelector('.tc-tg-now-line') as HTMLElement;
      expect(nowLineEl).not.toBeNull();
      const initialTop = nowLineEl.style.top;
      vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(nowLineEl.style.top).not.toBe(initialTop);

      view.destroy();
      setIntervalSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults shouldScrollToNow to true when the 4th param is omitted (preserves prior call-site behavior)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T14:30:00'));
    const container = freshContainer();
    const view = new TodayView(callbacks());
    view.render(container, [], resolvedConfig());
    const gridRowEl = container.querySelector('.tc-tg-grid-row') as HTMLElement;
    Object.defineProperty(gridRowEl, 'clientHeight', { value: 400, configurable: true });
    vi.runOnlyPendingTimers();
    expect(gridRowEl.scrollTop).toBe(496);
    vi.useRealTimers();
  });
});
