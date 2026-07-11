/**
 * Given an anchor date's weekday (moment's `d` format: Sunday=0..Saturday=6) and the
 * configured first-day-of-week (same 0-6 numbering), returns the (always <= 0) day offset
 * from the anchor to the start of the "firstDayOfWeek-aligned" week that contains it.
 *
 * Every week/month grid in this codebase (WeekTimeGridView, MonthGridView, WeekView,
 * MonthView, visibleCalendarDates) needs to turn an arbitrary anchor date into a run of 7
 * (or 7*6, for months) consecutive days that both starts on `firstDayOfWeek` and genuinely
 * contains the anchor. The naive `firstDayOfWeek - weekday` (no wraparound) is only correct
 * when `weekday >= firstDayOfWeek`; when the anchor's weekday is numerically *before*
 * firstDayOfWeek (the common case: anchor is a Sunday (0) and firstDayOfWeek is Monday (1)),
 * that arithmetic yields a *positive* offset, walking forward into the following week
 * instead of back to the start of the current one — entirely excluding the anchor date from
 * the rendered range. Wrapping via `% 7` (normalized to stay non-negative) fixes this for
 * every weekday/firstDayOfWeek combination.
 */
export function weekStartOffset(weekday: number, firstDayOfWeek: number): number {
  // `|| 0` collapses the `-0` that arithmetic yields when weekday === firstDayOfWeek
  // into a plain `0` — behaviorally identical for date math, but avoids surprising
  // `Object.is`-based equality checks (e.g. `toBe(0)` in tests).
  return -(((weekday - firstDayOfWeek) % 7) + 7) % 7 || 0;
}
