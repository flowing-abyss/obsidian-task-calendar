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
    onTimeChange: vi.fn(),
    onDurationChange: vi.fn(),
    onStartChange: vi.fn(),
    onDueChange: vi.fn(),
    onToggle: vi.fn(),
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
});
