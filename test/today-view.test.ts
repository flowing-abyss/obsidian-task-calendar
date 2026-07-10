import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { bucketTasksForDate, TodayView } from '../src/views/TodayView';
import { freshContainer, resolvedConfig, task, useRealMoment } from './helpers';

useRealMoment();

const fakeApp = {} as App;

function callbacks() {
  return {
    app: fakeApp,
    onTaskClick: vi.fn(),
    onDrop: vi.fn(),
    onTimeChange: vi.fn(),
    onDurationChange: vi.fn(),
    onStartChange: vi.fn(),
    onDueChange: vi.fn(),
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
});
