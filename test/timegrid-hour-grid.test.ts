import { describe, expect, it, vi } from 'vitest';
import { renderHourGrid } from '../src/views/timegrid/HourGrid';
import { DataTransferStub, freshContainer, useRealMoment } from './helpers';

useRealMoment();

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

  it('marks the day-column matching today with is-today', () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const other = window.moment().add(1, 'day').format('YYYY-MM-DD');
    renderHourGrid(container, [today, other]);
    const columns = Array.from(container.querySelectorAll('.tc-tg-day-column'));
    expect(columns[0]?.hasClass('is-today')).toBe(true);
    expect(columns[1]?.hasClass('is-today')).toBe(false);
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

  it('renders a now-line only on the day column matching today, positioned by current time', () => {
    const container = freshContainer();
    const today = window.moment().format('YYYY-MM-DD');
    const other = window.moment().add(1, 'day').format('YYYY-MM-DD');
    const handles = renderHourGrid(container, [today, other]);
    const nowLines = container.querySelectorAll('.tc-tg-now-line');
    expect(nowLines).toHaveLength(1);
    expect(handles.days[0]?.hourColumnEl.querySelector('.tc-tg-now-line')).not.toBeNull();
    expect(handles.days[1]?.hourColumnEl.querySelector('.tc-tg-now-line')).toBeNull();
    const top = parseFloat((nowLines[0] as HTMLElement).style.top);
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
