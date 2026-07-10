import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { MonthGridView } from '../src/views/MonthGridView';
import { freshContainer, resolvedConfig, task, useRealMoment } from './helpers';

useRealMoment();
const fakeApp = {} as App;
const registry = new StatusRegistry(buildDefaultTaskStatuses());

function callbacks() {
  return {
    app: fakeApp,
    onDayClick: vi.fn(),
    onTaskClick: vi.fn(),
    onDrop: vi.fn(),
    statusRegistry: registry,
  };
}

describe('MonthGridView', () => {
  it('renders a 6-week grid (42 day cells) for the configured month', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    view.render(container, [], resolvedConfig({ startPosition: '2026-07' }));
    expect(container.querySelectorAll('.tc-mg-cell')).toHaveLength(42);
  });

  it('a plain task on a given day renders a compact row in that cell', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    const t = task({ due: '2026-07-15', text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const cell = container.querySelector('[data-mg-date="2026-07-15"]');
    expect(cell?.querySelector('.tc-mg-plain')?.textContent).toContain('Plain');
  });

  it('sets data-priority on compact items for a prioritized task, omits it for D', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    const t = task({ due: '2026-07-15', priority: 'C', text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('[data-mg-date="2026-07-15"] .tc-mg-plain') as HTMLElement;
    expect(row.getAttribute('data-priority')).toBe('C');

    const container2 = freshContainer();
    const view2 = new MonthGridView(callbacks());
    const none = task({ due: '2026-07-15', priority: 'D', text: 'Plain' });
    view2.render(container2, [none], resolvedConfig({ startPosition: '2026-07' }));
    const row2 = container2.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-plain',
    ) as HTMLElement;
    expect(row2.hasAttribute('data-priority')).toBe(false);
  });

  it('sets --tc-tag-color on compact items when a tag matches a configured tag group', () => {
    const container = freshContainer();
    const cbs = {
      ...callbacks(),
      tagGroups: [
        { id: '1', name: 'Work', mode: 'prefix' as const, prefix: 'work', color: '#3498db' },
      ],
    };
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', rawText: '- [ ] t #work', text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('[data-mg-date="2026-07-15"] .tc-mg-plain') as HTMLElement;
    expect(row.style.getPropertyValue('--tc-tag-color')).toBe('#3498db');
  });

  it('clicking a current-month day cell (not a task) fires onDayClick with that date', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    view.render(container, [], resolvedConfig({ startPosition: '2026-07' }));
    const cell = container.querySelector('[data-mg-date="2026-07-15"]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onDayClick).toHaveBeenCalledWith('2026-07-15');
  });

  it('each day cell keeps a daily-note internal-link, separate from the drill-down click', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    view.render(
      container,
      [],
      resolvedConfig({ startPosition: '2026-07', dailyNoteFolder: 'Daily' }),
    );
    const cell = container.querySelector('[data-mg-date="2026-07-15"]') as HTMLElement;
    const link = cell.querySelector('a.internal-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('Daily/2026-07-15');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onDayClick).not.toHaveBeenCalled(); // link click must not also trigger drill-down
  });

  it('destroy() does not throw', () => {
    const view = new MonthGridView(callbacks());
    expect(() => view.destroy()).not.toThrow();
  });
});
