import { describe, expect, it } from 'vitest';
import { visibleCalendarDates } from '../src/panels/visibleCalendarDates';
import { useRealMoment } from './helpers';

useRealMoment();

describe('visibleCalendarDates', () => {
  it('today: returns exactly the one date', () => {
    const dates = visibleCalendarDates('today', window.moment('2026-07-10'), 1);
    expect(dates).toEqual(['2026-07-10']);
  });

  it('week: returns 7 consecutive dates respecting firstDayOfWeek', () => {
    const dates = visibleCalendarDates('week', window.moment('2026-07-10'), 1);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-07-06'); // Monday
    expect(dates[6]).toBe('2026-07-12'); // Sunday
  });

  it('week: shifts start day when firstDayOfWeek is Sunday', () => {
    const dates = visibleCalendarDates('week', window.moment('2026-07-10'), 0);
    expect(dates[0]).toBe('2026-07-05'); // Sunday
  });

  it("week: matches WeekTimeGridView's own YYYY-ww round-trip at the Dec/Jan boundary (regression)", () => {
    // moment's non-ISO 'ww' week-of-year token misassigns late-December dates to
    // week 01 of a different nominal year. WeekTimeGridView.render reconstructs the
    // week by round-tripping calDate through CenterPanel's `format('YYYY-ww')` →
    // `moment(startPosition, 'YYYY-ww').startOf('week')`. This function MUST
    // reproduce that exact (bug-compatible) round-trip, or the store query scopes
    // to a different week than what actually renders and every cell goes empty.
    const calDate = window.moment('2025-12-29'); // a Monday
    const dates = visibleCalendarDates('week', calDate, 1);
    // Matches WeekTimeGridView's own computation for this calDate exactly (verified
    // independently: startPosition='2025-01' → moment('2025-01','YYYY-ww').startOf('week')
    // → 2024-12-29 Sun, shifted by firstDayOfWeek=1 to start on 2024-12-30 Mon).
    expect(dates[0]).toBe('2024-12-30');
    expect(dates[6]).toBe('2025-01-05');
  });

  it("month: returns exactly 42 dates (6 weeks x 7 days), matching MonthGridView's cell count", () => {
    const dates = visibleCalendarDates('month', window.moment('2026-07-01'), 1);
    expect(dates).toHaveLength(42);
    // July 2026 starts on a Wednesday; with firstDayOfWeek=1 (Monday), the grid
    // starts on Mon 2026-06-29 and the month itself (2026-07-01..31) is fully covered.
    expect(dates).toContain('2026-06-29');
    expect(dates).toContain('2026-07-01');
    expect(dates).toContain('2026-07-31');
  });
});
