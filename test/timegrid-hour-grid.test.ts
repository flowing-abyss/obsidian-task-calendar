import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderHourGrid, repositionNowLine } from '../src/views/timegrid/HourGrid';
import { DataTransferStub, freshContainer, useRealMoment } from './helpers';

useRealMoment();

const css = readFileSync(resolve(import.meta.dirname, '..', 'styles.css'), 'utf8');

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\\,/gu, ',');
  const match = new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'u').exec(css);
  return match?.groups?.['body'] ?? '';
}

describe('renderHourGrid', () => {
  it('renders a day-header cell per date with weekday + day number', () => {
    const container = freshContainer();
    renderHourGrid(container, ['2026-07-10', '2026-07-11']);
    const headers = container.querySelectorAll('.tc-tg-header-cell');
    expect(headers).toHaveLength(2);
    expect(headers[0]?.textContent).toContain('Fri');
    expect(headers[0]?.textContent).toContain('10');
    expect(headers[1]?.textContent).toContain('Sat');
    expect(headers[1]?.textContent).toContain('11');
  });

  it('marks the header cell matching today with is-today', () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const other = window.moment().add(1, 'day').format('YYYY-MM-DD');
    renderHourGrid(container, [today, other]);
    const headers = Array.from(container.querySelectorAll('.tc-tg-header-cell'));
    expect(headers[0]?.hasClass('is-today')).toBe(true);
    expect(headers[1]?.hasClass('is-today')).toBe(false);
  });

  it('never marks the day-column itself with is-today (no full-column border in any view)', () => {
    // Round 3: the day-column's box-shadow border was removed entirely — Day view found it
    // redundant (only one column, obviously "today") and Week found a full-height border
    // around one column too visually noisy. "Today" is now conveyed only via the header's
    // accented day-number (see the header-cell tests below), never a column-level class.
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const other = window.moment().add(1, 'day').format('YYYY-MM-DD');
    renderHourGrid(container, [today, other]);
    const columns = Array.from(container.querySelectorAll('.tc-tg-day-column'));
    expect(columns[0]?.hasClass('is-today')).toBe(false);
    expect(columns[1]?.hasClass('is-today')).toBe(false);
  });

  it('single-date (Day/Today view) render has no is-today day-column anywhere', () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    renderHourGrid(container, [today]);
    const columns = Array.from(container.querySelectorAll('.tc-tg-day-column'));
    expect(columns.every((c) => !c.hasClass('is-today'))).toBe(true);
  });

  it("splits the header cell's date into an independently-selectable weekday span and day-number span", () => {
    const container = freshContainer();
    renderHourGrid(container, ['2026-07-10']);
    const header = container.querySelector('.tc-tg-header-cell') as HTMLElement;
    const weekday = header.querySelector('.tc-tg-header-weekday');
    const dayNumber = header.querySelector('.tc-tg-header-day-number');
    expect(weekday?.textContent).toBe('Fri');
    expect(dayNumber?.textContent).toBe('10');
  });

  it("accents only today's header day-number span, in a multi-date (Week) render", () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const other = window.moment().add(1, 'day').format('YYYY-MM-DD');
    renderHourGrid(container, [today, other]);
    const headers = Array.from(container.querySelectorAll('.tc-tg-header-cell'));
    expect(headers[0]?.hasClass('is-today')).toBe(true);
    expect(headers[0]?.querySelector('.tc-tg-header-day-number')).not.toBeNull();
    expect(headers[1]?.hasClass('is-today')).toBe(false);
  });

  it('renders one day column per date, with 24 hour rows each', () => {
    const container = freshContainer();
    const handles = renderHourGrid(container, ['2026-07-10']);
    expect(handles.days).toHaveLength(1);
    expect(handles.days[0]?.date).toBe('2026-07-10');
    expect(container.querySelectorAll('.tc-tg-hour-row')).toHaveLength(24);
  });

  it('renders 7 day columns for a week of dates', () => {
    const container = freshContainer();
    const dates = [
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ];
    const handles = renderHourGrid(container, dates);
    expect(handles.days).toHaveLength(7);
    expect(handles.days.map((d) => d.date)).toEqual(dates);
    expect(container.querySelectorAll('.tc-tg-day-column')).toHaveLength(7);
  });

  it('labels the all-day gutter "No-time" so its purpose is clear', () => {
    const container = freshContainer();
    renderHourGrid(container, ['2026-07-10']);
    const gutter = container.querySelector('.tc-tg-allday-gutter') as HTMLElement;
    expect(gutter.textContent).toBe('No-time');
  });

  it('each day gets an independent all-day cell element', () => {
    const container = freshContainer();
    const handles = renderHourGrid(container, ['2026-07-10', '2026-07-11']);
    expect(handles.days[0]?.allDayCellEl).not.toBe(handles.days[1]?.allDayCellEl);
    expect(container.querySelectorAll('.tc-tg-allday-cell')).toHaveLength(2);
  });

  it('hourColumnEl is positioned relative (so absolutely-positioned blocks anchor to it)', () => {
    const container = freshContainer();
    const handles = renderHourGrid(container, ['2026-07-10']);
    expect(handles.days[0]?.hourColumnEl.hasClass('tc-tg-hour-column')).toBe(true);
  });

  it('re-rendering into the same container clears prior content', () => {
    const container = freshContainer();
    renderHourGrid(container, ['2026-07-10']);
    renderHourGrid(container, ['2026-07-11']);
    expect(container.querySelectorAll('.tc-tg-day-column')).toHaveLength(1);
  });

  it('renders exactly one now-line for the whole grid, as a child of the grid-row (not any single day-column), positioned by current time', () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const other = window.moment().add(1, 'day').format('YYYY-MM-DD');
    const handles = renderHourGrid(container, [today, other]);
    const nowLines = container.querySelectorAll('.tc-tg-now-line');
    expect(nowLines).toHaveLength(1);
    const nowLine = nowLines[0] as HTMLElement;
    expect(nowLine.parentElement).toBe(handles.gridRowEl);
    expect(handles.days[0]?.hourColumnEl.querySelector('.tc-tg-now-line')).toBeNull();
    expect(handles.days[1]?.hourColumnEl.querySelector('.tc-tg-now-line')).toBeNull();
    const top = parseFloat(nowLine.style.top);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it("positions the now-line's dot marker at today's column offset, expressed as a percentage of the line's width", () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const yesterday = window.moment().subtract(1, 'day').format('YYYY-MM-DD');
    const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');
    // today is index 1 of 3 dates -> dot should sit at (1 + 0.5) / 3 = 50%
    const handles = renderHourGrid(container, [yesterday, today, tomorrow]);
    const dot = handles.nowLineEl?.querySelector('.tc-tg-now-line-dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.left).toBe('50%');
  });

  it('single-date (Day view) render still shows a now-line with the dot centered on the only column', () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const handles = renderHourGrid(container, [today]);
    const dot = handles.nowLineEl?.querySelector('.tc-tg-now-line-dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.left).toBe('50%');
  });

  it('no now-line dot is rendered when today is not among the rendered dates', () => {
    const container = freshContainer();
    const other = window.moment().add(5, 'days').format('YYYY-MM-DD');
    renderHourGrid(container, [other]);
    expect(container.querySelector('.tc-tg-now-line-dot')).toBeNull();
  });

  it('exposes the now-line element via handles so callers can reposition it later (periodic refresh)', () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const handles = renderHourGrid(container, [today]);
    expect(handles.nowLineEl).not.toBeNull();
    expect(handles.nowLineEl?.hasClass('tc-tg-now-line')).toBe(true);
  });

  it('nowLineEl is null when today is not among the rendered dates', () => {
    const container = freshContainer();
    const other = window.moment().add(5, 'days').format('YYYY-MM-DD');
    const handles = renderHourGrid(container, [other]);
    expect(handles.nowLineEl).toBeNull();
  });

  it('repositionNowLine recomputes top from the current time', () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const handles = renderHourGrid(container, [today]);
    const nowLineEl = handles.nowLineEl!;
    nowLineEl.style.top = '0px';
    repositionNowLine(nowLineEl);
    const top = parseFloat(nowLineEl.style.top);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it('exposes the scrollable grid-row container so callers can scroll to now', () => {
    const container = freshContainer();
    const handles = renderHourGrid(container, ['2026-07-10']);
    expect(handles.gridRowEl.hasClass('tc-tg-grid-row')).toBe(true);
  });

  it('dropping onto a day column computes the time from the drop Y-position', () => {
    const container = freshContainer();
    const onDropTime = vi.fn();
    const handles = renderHourGrid(container, ['2026-07-10'], onDropTime);
    const hourColumnEl = handles.days[0]!.hourColumnEl;
    // Stub getBoundingClientRect so a clientY of 148 maps to a known offset
    vi.spyOn(hourColumnEl, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 0,
    } as DOMRect);
    const dt = new DataTransferStub();
    dt.setData('text/plain', 'f.md:::0');
    const ev = new MouseEvent('drop', { bubbles: true, clientY: 148 });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    hourColumnEl.dispatchEvent(ev);
    expect(onDropTime).toHaveBeenCalledWith('f.md:::0', '2026-07-10', '01:00'); // (148-100)px = 48px = 60min
  });

  it('clicking empty hour-grid space fires onCreateAtTime with the computed time', () => {
    const container = freshContainer();
    const onCreateAtTime = vi.fn();
    const handles = renderHourGrid(container, ['2026-07-10'], undefined, onCreateAtTime);
    const hourColumnEl = handles.days[0]!.hourColumnEl;
    vi.spyOn(hourColumnEl, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 0,
    } as DOMRect);
    hourColumnEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 148 }));
    expect(onCreateAtTime).toHaveBeenCalledWith('2026-07-10', '01:00');
  });

  it('clicking on an existing timed block does not also fire onCreateAtTime', () => {
    const container = freshContainer();
    const onCreateAtTime = vi.fn();
    const handles = renderHourGrid(container, ['2026-07-10'], undefined, onCreateAtTime);
    const hourColumnEl = handles.days[0]!.hourColumnEl;
    const block = hourColumnEl.createDiv({ cls: 'tc-tg-block' });
    block.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCreateAtTime).not.toHaveBeenCalled();
  });

  it('does not wire a click listener when onCreateAtTime is not provided (no throw on click)', () => {
    const container = freshContainer();
    const handles = renderHourGrid(container, ['2026-07-10']);
    const hourColumnEl = handles.days[0]!.hourColumnEl;
    expect(() =>
      hourColumnEl.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    ).not.toThrow();
  });

  it('clicking a header cell fires onDayHeaderClick with that date', () => {
    const container = freshContainer();
    const onDayHeaderClick = vi.fn();
    const handles = renderHourGrid(
      container,
      ['2026-07-10', '2026-07-11'],
      undefined,
      undefined,
      onDayHeaderClick,
    );
    const headers = Array.from(container.querySelectorAll('.tc-tg-header-cell'));
    (headers[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDayHeaderClick).toHaveBeenCalledWith('2026-07-11');
    expect(handles.days).toHaveLength(2); // sanity: handles still line up with dates
    // Clickable headers advertise the affordance (pointer/hover is CSS-gated on is-clickable).
    expect((headers[0] as HTMLElement).classList.contains('is-clickable')).toBe(true);
  });

  it('does not wire a header click listener when onDayHeaderClick is not provided (no throw on click), and does not advertise clickability', () => {
    const container = freshContainer();
    renderHourGrid(container, ['2026-07-10']);
    const header = container.querySelector('.tc-tg-header-cell') as HTMLElement;
    expect(() => header.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    // No handler → no false pointer-cursor/hover affordance (Day/Today view's single header).
    expect(header.classList.contains('is-clickable')).toBe(false);
  });

  it('clicking inside the all-day band does not fire onDayHeaderClick (separate row from the header)', () => {
    const container = freshContainer();
    const onDayHeaderClick = vi.fn();
    renderHourGrid(container, ['2026-07-10'], undefined, undefined, onDayHeaderClick);
    const alldayCell = container.querySelector('.tc-tg-allday-cell') as HTMLElement;
    alldayCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDayHeaderClick).not.toHaveBeenCalled();
  });

  it('does not wire drop listeners when onDropTime is not provided (no throw on drop)', () => {
    const container = freshContainer();
    const handles = renderHourGrid(container, ['2026-07-10']);
    const hourColumnEl = handles.days[0]!.hourColumnEl;
    vi.spyOn(hourColumnEl, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 0,
    } as DOMRect);
    const dt = new DataTransferStub();
    dt.setData('text/plain', 'f.md:::0');
    const ev = new MouseEvent('drop', { bubbles: true, clientY: 148 });
    Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
    expect(() => hourColumnEl.dispatchEvent(ev)).not.toThrow();
  });
});

describe('is-today styling (Round 3: no column border anywhere, header day-number accent only)', () => {
  it('.tc-tg-day-column.is-today no longer declares a box-shadow border', () => {
    expect(css).not.toMatch(/\.tc-tg-day-column\.is-today\s*\{[^}]*box-shadow/u);
  });

  it('.tc-tg-header-cell.is-today no longer colors the whole header cell text', () => {
    const declarations = declarationsFor('.tc-tg-header-cell.is-today');
    // The old rule set `color` directly on the header cell; that's been replaced by a
    // more specific rule targeting only the day-number span (checked below).
    expect(declarations).toBe('');
  });

  it('accents the day-number span red/bold when its header cell is is-today', () => {
    const declarations = declarationsFor('.tc-tg-header-cell.is-today .tc-tg-header-day-number');
    expect(declarations).toContain('var(--text-error)');
    expect(declarations).toMatch(/font-weight:\s*700/u);
  });
});

describe('tag-fill background (Round 3 Task 24: solid, not washed-out/gridline-bleeding)', () => {
  it('shares one background rule across timed blocks, all-day spans/plain, and Month compact items', () => {
    const selector =
      '.tc-tg-block,\n.tc-tg-span,\n.tc-tg-plain,\n.tc-mg-block-dot,\n.tc-mg-span-segment,\n.tc-mg-plain';
    const declarations = declarationsFor(selector);
    expect(declarations).toContain('background:');
  });

  it('mixes the tag color against a solid background (not `transparent`), so the fill is fully opaque and can never let the hour-gridline (or anything else behind it) show through — regardless of the mix percentage', () => {
    const selector =
      '.tc-tg-block,\n.tc-tg-span,\n.tc-tg-plain,\n.tc-mg-block-dot,\n.tc-mg-span-segment,\n.tc-mg-plain';
    const declarations = declarationsFor(selector);
    const match = new RegExp(
      'background:\\s*color-mix\\(\\s*in srgb,\\s*var\\(--tc-tag-color, var\\(--interactive-accent\\)\\)\\s*(\\d+)%,\\s*([^,)]+)\\s*\\)',
      'u',
    ).exec(declarations);
    expect(match).not.toBeNull();
    expect(match?.[2]?.trim()).not.toBe('transparent');
    // A meaningful lower bound, not a pixel-perfect pin: below this the tag color reads as
    // pale/washed-out (the original bug report). The upper bound isn't asserted here — that's
    // a visual/legibility judgment call (see styles.css comment), not a testable invariant.
    const pct = Number(match?.[1]);
    expect(pct).toBeGreaterThanOrEqual(30);
  });
});

describe('.tc-tg-grid-row layout (regression: today-column outline / click-drop hit-test truncation)', () => {
  it('does not stretch day-columns to the scroll container height', () => {
    // Regression test: .tc-tg-grid-row is a flex row whose children (the hour-gutter and each
    // day-column) hold 24 hour-rows of real content (1152px), but the row itself is a shorter,
    // scrollable viewport. Without `align-items: flex-start`, the default `stretch` sizes every
    // day-column's own box to the *visible* container height instead of its 1152px content —
    // which in turn truncates .tc-tg-hour-column (positioned `inset: 0` to its day-column parent)
    // to that same short height, silently clipping click-to-create/drag-drop hit-testing and the
    // is-today red outline partway down the column (confirmed live: the outline stopped around
    // 17:00 in a viewport tall enough to show ~16.5 hours, while hour-row gridlines kept
    // rendering past that point as unclipped normal-flow overflow).
    const gridRow = declarationsFor('.tc-tg-grid-row');
    expect(gridRow).toContain('align-items: flex-start');
  });
});
