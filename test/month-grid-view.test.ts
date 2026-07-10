import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { MonthGridView } from '../src/views/MonthGridView';
import { DataTransferStub, freshContainer, resolvedConfig, task, useRealMoment } from './helpers';

useRealMoment();
const fakeApp = {} as App;
const registry = new StatusRegistry(buildDefaultTaskStatuses());

function callbacks() {
  return {
    app: fakeApp,
    onDayClick: vi.fn(),
    onCreateAtDate: vi.fn(),
    onTaskClick: vi.fn(),
    onDrop: vi.fn(),
    onToggle: vi.fn(),
    onWeekClick: vi.fn(),
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

  it('never sets data-priority on compact items, even for a prioritized task (calendar items no longer render a priority border)', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    const t = task({ due: '2026-07-15', priority: 'C', text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('[data-mg-date="2026-07-15"] .tc-mg-plain') as HTMLElement;
    expect(row.hasAttribute('data-priority')).toBe(false);

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

  it('each day cell has a hover-visible add button that fires onCreateAtDate, not onDayClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    view.render(container, [], resolvedConfig({ startPosition: '2026-07' }));
    const cell = container.querySelector('[data-mg-date="2026-07-15"]') as HTMLElement;
    const addBtn = cell.querySelector('.tc-mg-add-btn') as HTMLElement;
    expect(addBtn).not.toBeNull();
    addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onCreateAtDate).toHaveBeenCalledWith('2026-07-15');
    expect(cbs.onDayClick).not.toHaveBeenCalled();
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

  it('a plain click on a compact plain row does NOT fire onTaskClick (reserved for drag)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('[data-mg-date="2026-07-15"] .tc-mg-plain') as HTMLElement;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('a right-click (contextmenu) on a compact plain row fires onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('[data-mg-date="2026-07-15"] .tc-mg-plain') as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(cbs.onTaskClick).toHaveBeenCalledWith(t);
  });

  it('a plain click on a compact block-dot does NOT fire onTaskClick (reserved for drag)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', time: '09:00', text: 'Timed' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const dot = container.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-block-dot',
    ) as HTMLElement;
    dot.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('a right-click (contextmenu) on a compact block-dot fires onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', time: '09:00', text: 'Timed' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const dot = container.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-block-dot',
    ) as HTMLElement;
    dot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(cbs.onTaskClick).toHaveBeenCalledWith(t);
  });

  it('a plain click on a compact span-segment does NOT fire onTaskClick (reserved for drag)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ start: '2026-07-14', due: '2026-07-16', text: 'Trip' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const bar = container.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-span-segment',
    ) as HTMLElement;
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('a right-click (contextmenu) on a compact span-segment fires onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ start: '2026-07-14', due: '2026-07-16', text: 'Trip' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const bar = container.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-span-segment',
    ) as HTMLElement;
    bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(cbs.onTaskClick).toHaveBeenCalledWith(t);
  });

  it('a plain click on a compact deadline marker does NOT fire onTaskClick (reserved for drag)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', scheduled: '2026-07-10', text: 'Deadline' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const marker = container.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-deadline-marker',
    ) as HTMLElement;
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('a right-click (contextmenu) on a compact deadline marker fires onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', scheduled: '2026-07-10', text: 'Deadline' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const marker = container.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-deadline-marker',
    ) as HTMLElement;
    marker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(cbs.onTaskClick).toHaveBeenCalledWith(t);
  });

  it('renders a status marker as the first child of a compact plain row; clicking it fires onToggle, not onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('[data-mg-date="2026-07-15"] .tc-mg-plain') as HTMLElement;
    const marker = row.querySelector('.tc-status-marker');
    expect(marker).not.toBeNull();
    expect(row.firstElementChild).toBe(marker);
    (marker as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('renders a status marker as the first child of a compact block-dot; clicking it fires onToggle, not onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', time: '09:00', text: 'Timed' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const dot = container.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-block-dot',
    ) as HTMLElement;
    const marker = dot.querySelector('.tc-status-marker');
    expect(marker).not.toBeNull();
    expect(dot.firstElementChild).toBe(marker);
    (marker as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('renders a status marker as the first child of a compact span-segment; clicking it fires onToggle, not onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ start: '2026-07-14', due: '2026-07-16', text: 'Trip' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const bar = container.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-span-segment',
    ) as HTMLElement;
    const marker = bar.querySelector('.tc-status-marker');
    expect(marker).not.toBeNull();
    expect(bar.firstElementChild).toBe(marker);
    (marker as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('renders a status marker as the first child of a compact deadline marker; clicking it fires onToggle, not onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', scheduled: '2026-07-10', text: 'Deadline' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const markerEl = container.querySelector(
      '[data-mg-date="2026-07-15"] .tc-mg-deadline-marker',
    ) as HTMLElement;
    const marker = markerEl.querySelector('.tc-status-marker');
    expect(marker).not.toBeNull();
    expect(markerEl.firstElementChild).toBe(marker);
    (marker as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('destroy() does not throw', () => {
    const view = new MonthGridView(callbacks());
    expect(() => view.destroy()).not.toThrow();
  });

  it('renders a compact plain-row title via renderTaskText (markdown-link-aware) for a task with a [[wikilink]]', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    const t = task({ due: '2026-07-15', text: 'see [[Note]]', markdownText: 'see [[Note]]' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('[data-mg-date="2026-07-15"] .tc-mg-plain') as HTMLElement;
    // MarkdownRenderer is a noop in this test harness (see test/center-panel-integration.test.ts
    // and friends); `.tc-md` is the reliable signal that renderTaskText's markdown path (not a
    // raw textContent assignment) was taken.
    expect(row.querySelector('.tc-md')).not.toBeNull();
  });

  it('a click on the compact row title (inside a [[wikilink]]-bearing task) still does not fire onDayClick, since the row container class is excluded regardless of nested content', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', text: 'see [[Note]]', markdownText: 'see [[Note]]' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('[data-mg-date="2026-07-15"] .tc-mg-plain') as HTMLElement;
    const titleEl = row.querySelector('.tc-md') as HTMLElement;
    titleEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onDayClick).not.toHaveBeenCalled();
  });

  it('renders a week-number button per row, clicking it fires onWeekClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    view.render(container, [], resolvedConfig({ startPosition: '2026-07' }));
    const weekBtns = container.querySelectorAll('.tc-mg-week-btn');
    expect(weekBtns.length).toBe(6);
    (weekBtns[0] as HTMLElement).click();
    expect(cbs.onWeekClick).toHaveBeenCalled();
  });

  it('the week-number button passes the correct week number and year', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    view.render(container, [], resolvedConfig({ startPosition: '2026-07' }));
    const weekBtns = container.querySelectorAll('.tc-mg-week-btn');
    (weekBtns[0] as HTMLElement).click();
    const expectedWeek = window.moment('2026-06-29', 'YYYY-MM-DD').format('w');
    const expectedYear = window.moment('2026-06-29', 'YYYY-MM-DD').format('YYYY');
    expect(cbs.onWeekClick).toHaveBeenCalledWith(expectedWeek, expectedYear);
  });

  it('clicking the week-number button does not bubble into any day-cell click handling', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    view.render(container, [], resolvedConfig({ startPosition: '2026-07' }));
    const weekBtn = container.querySelector('.tc-mg-week-btn') as HTMLElement;
    weekBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onDayClick).not.toHaveBeenCalled();
  });

  it('a plain-task item is draggable with the filePath:::line payload', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    const t = task({ due: '2026-07-15', filePath: 'f.md', line: 3, text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const item = container.querySelector('.tc-mg-plain') as HTMLElement;
    expect(item.getAttribute('draggable')).toBe('true');
    const dt = new DataTransferStub();
    const ev = new MouseEvent('dragstart', { bubbles: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    item.dispatchEvent(ev);
    expect(dt.getData('text/plain')).toBe('f.md:::3');
    expect(item.classList.contains('is-dragging')).toBe(true);
  });

  it('a block-dot (timed) item is draggable with the filePath:::line payload', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    const t = task({ due: '2026-07-15', time: '09:00', filePath: 'f.md', line: 7, text: 'Timed' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const item = container.querySelector('.tc-mg-block-dot') as HTMLElement;
    expect(item.getAttribute('draggable')).toBe('true');
    const dt = new DataTransferStub();
    const ev = new MouseEvent('dragstart', { bubbles: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    item.dispatchEvent(ev);
    expect(dt.getData('text/plain')).toBe('f.md:::7');
  });

  it('a span-segment item is draggable with the filePath:::line payload', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    const t = task({
      start: '2026-07-14',
      due: '2026-07-16',
      filePath: 'f.md',
      line: 9,
      text: 'Trip',
    });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const item = container.querySelector('.tc-mg-span-segment') as HTMLElement;
    expect(item.getAttribute('draggable')).toBe('true');
    const dt = new DataTransferStub();
    const ev = new MouseEvent('dragstart', { bubbles: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    item.dispatchEvent(ev);
    expect(dt.getData('text/plain')).toBe('f.md:::9');
  });

  it('deadline markers stay non-draggable', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    const t = task({
      due: '2026-07-15',
      scheduled: '2026-07-10',
      filePath: 'f.md',
      line: 11,
      text: 'Deadline',
    });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const marker = container.querySelector('.tc-mg-deadline-marker') as HTMLElement;
    expect(marker.hasAttribute('draggable')).toBe(false);
  });

  it('a click on the status marker inside a now-draggable plain item still fires onToggle, not treated as a drag', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({ due: '2026-07-15', filePath: 'f.md', line: 3, text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('.tc-mg-plain') as HTMLElement;
    const marker = row.querySelector('.tc-status-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('a click on the rendered link inside a now-draggable plain item still navigates (does not start a drag)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const view = new MonthGridView(cbs);
    const t = task({
      due: '2026-07-15',
      filePath: 'f.md',
      line: 3,
      text: 'see [[Note]]',
      markdownText: 'see [[Note]]',
    });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('.tc-mg-plain') as HTMLElement;
    expect(row.getAttribute('draggable')).toBe('true');
    // A plain click on the title (not a dragstart) must not be swallowed — it's a normal
    // click event, distinct from the native HTML5 drag gesture which only starts on
    // dragstart, not click.
    const titleEl = row.querySelector('.tc-md') as HTMLElement;
    titleEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onDayClick).not.toHaveBeenCalled();
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('renders a compact tag chip and count badge (capped at 1 tag) on a plain compact item', () => {
    const container = freshContainer();
    const view = new MonthGridView({
      ...callbacks(),
      tagGroups: [{ id: '1', name: 'Work', mode: 'prefix', prefix: 'work', color: '#3498db' }],
    });
    const t = task({
      due: '2026-07-15',
      text: 'Plain',
      rawText: '- [ ] Plain #work #urgent',
      linkCount: 1,
    });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('.tc-mg-plain') as HTMLElement;
    const meta = row.querySelector('.tc-mg-item-meta') as HTMLElement;
    expect(meta).not.toBeNull();
    expect(meta.querySelector('.tc-task-count-badge')).not.toBeNull();
    expect(meta.querySelectorAll('.tc-task-tag')).toHaveLength(1);
  });

  it('omits .tc-mg-item-meta entirely for a compact item with no tags/subtasks/comments/links', () => {
    const container = freshContainer();
    const view = new MonthGridView(callbacks());
    const t = task({ due: '2026-07-15', text: 'Plain' });
    view.render(container, [t], resolvedConfig({ startPosition: '2026-07' }));
    const row = container.querySelector('.tc-mg-plain') as HTMLElement;
    expect(row.querySelector('.tc-mg-item-meta')).toBeNull();
  });
});
