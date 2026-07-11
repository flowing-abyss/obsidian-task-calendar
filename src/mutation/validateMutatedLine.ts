import { parseTask } from '../parser/TaskParser';
import type { ParseContext } from '../parser/types';

/** A syntactically *and* semantically valid 24-hour HH:MM clock time (00:00–23:59). */
const VALID_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/u;
/** `YYYY-MM-DD` shape — real calendar-day validity is checked separately below. */
const DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/u;

function isRealCalendarDate(date: string): boolean {
  if (!DATE_SHAPE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  // `Date` silently rolls invalid components over into the next month/year (e.g. day 32 of
  // January becomes February 1st) instead of throwing — round-tripping the parsed value back
  // through its own getters is the standard way to detect that rollover happened.
  return (
    parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
  );
}

/**
 * Task 33 data-safety net: re-parse a candidate task line (before it is ever written to disk)
 * and confirm it is still a well-formed, sane task.
 *
 * Root cause this guards against: an unbounded/malformed drag-computed value (e.g. dragging a
 * timed block far enough to compute an out-of-range start time like "2093:15") produces a line
 * that *looks* plausible as a string but no longer round-trips through the parser — the ⏰ token's
 * `\d{1,2}` hour group can't match a 3+ digit hour, so `TIME_RE`/`formatTaskLine`'s own time regex
 * silently fail to recognize it. The result: `task.time` comes back `undefined` even though the
 * literal "⏰ 2093:15" text is still sitting in the line, the task drops out of every time-based
 * view's `tasksWithTime` filter (the reported "disappeared from the calendar" symptom), and the
 * garbage token leaks into the visible title instead of being stripped as metadata.
 *
 * Returns `false` (reject the mutation — caller must leave the original line untouched) when:
 * - the line no longer matches the task-line grammar at all (`parseTask` returns `null`)
 * - the line still literally contains a ⏰/⏱️/📅/⏳/🛫/✅/❌ metadata glyph, but the field that
 *   glyph feeds came back empty/`undefined` — the direct symptom of a malformed token
 * - a parsed time is outside the real 00:00–23:59 range (e.g. an in-range-digit-count but
 *   still-impossible time such as "25:00")
 * - a parsed duration is not a finite, positive number
 * - a parsed date field is not a real calendar date (e.g. day 32, month 13)
 */
export function validateMutatedTaskLine(line: string, ctx: ParseContext): boolean {
  const task = parseTask(line, ctx);
  if (!task) return false;

  if (line.includes('⏰') && (!task.time || !VALID_TIME_RE.test(task.time))) return false;
  if (
    line.includes('⏱️') &&
    (task.duration === undefined || !Number.isFinite(task.duration) || task.duration <= 0)
  ) {
    return false;
  }

  const dateFields: Array<[glyph: string, value: string | undefined]> = [
    ['📅', task.due],
    ['⏳', task.scheduled],
    ['🛫', task.start],
    ['✅', task.completion],
    ['❌', task.cancelledDate],
  ];
  for (const [glyph, value] of dateFields) {
    if (line.includes(glyph) && (!value || !isRealCalendarDate(value))) return false;
  }

  return true;
}
