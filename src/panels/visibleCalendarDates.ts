import { weekStartOffset } from '../domain/weekGridOffset';

export type CalViewType = 'today' | 'week' | 'month';

/**
 * The exact set of dates a calendar view will render for the given
 * view type/date/first-day-of-week, mirroring TodayView/WeekTimeGridView/
 * MonthGridView's own date math. Used to scope a TaskStore.getTasksForDateRange
 * query to only the visible range, instead of scanning every task in the vault.
 */
export function visibleCalendarDates(
  viewType: CalViewType,
  calDate: ReturnType<typeof window.moment>,
  firstDayOfWeek: number,
): string[] {
  if (viewType === 'today') {
    return [calDate.format('YYYY-MM-DD')];
  }

  if (viewType === 'week') {
    // Must reproduce CenterPanel's own startPosition computation exactly (not just
    // calDate.startOf('week') directly) — moment's non-ISO 'ww' week-of-year token always
    // round-trips to a Sunday anchor (misassigning late-December dates to week 01 of a
    // different year at year boundaries, and — Task 42b — always excluding calDate itself
    // whenever calDate IS that Sunday and firstDayOfWeek isn't 0), so a "more correct"
    // independent computation here would silently diverge from what the view actually
    // renders. CenterPanel.startPositionFor shifts calDate back by firstDayOfWeek days
    // before formatting to compensate — this must mirror that exact shift, or the store
    // query scopes to a different week than what actually renders and every cell goes empty.
    const week = window
      .moment(calDate.clone().subtract(firstDayOfWeek, 'days').format('YYYY-ww'), 'YYYY-ww')
      .startOf('week');
    const dates: string[] = [];
    for (let i = firstDayOfWeek; i < firstDayOfWeek + 7; i++) {
      dates.push(week.clone().add(i, 'days').format('YYYY-MM-DD'));
    }
    return dates;
  }

  // month: 6 weeks x 7 days, matching MonthGridView's cell grid exactly (including
  // prev/next-month overflow cells, which are visible and must be included).
  const month = calDate.clone().date(1);
  const firstDayOfMonth = parseInt(month.format('d'), 10);
  const dates: string[] = [];
  let starts = weekStartOffset(firstDayOfMonth, firstDayOfWeek);
  for (let w = 0; w < 6; w++) {
    for (let i = starts; i < starts + 7; i++) {
      dates.push(month.clone().add(i, 'days').format('YYYY-MM-DD'));
    }
    starts += 7;
  }
  return dates;
}
