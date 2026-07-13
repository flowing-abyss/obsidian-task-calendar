import { parseTask } from '../parser/TaskParser';
import type { ParseContext } from '../parser/types';
import { durationMinutes, localDate, localTime } from '../tasks/domain/validation';

function isRealCalendarDate(date: string): boolean {
  try {
    localDate(date);
    return true;
  } catch {
    return false;
  }
}

function isValidTime(time: string): boolean {
  try {
    localTime(time);
    return true;
  } catch {
    return false;
  }
}

function isValidDuration(duration: number): boolean {
  try {
    durationMinutes(duration);
    return true;
  } catch {
    return false;
  }
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
 * - both `start` and `due` are present and `start` is strictly AFTER `due` (Task 51: an
 *   inverted span) — see this file's own cross-field check below for the full story
 */
export function validateMutatedTaskLine(line: string, ctx: ParseContext): boolean {
  const task = parseTask(line, ctx);
  if (!task) return false;

  if (line.includes('⏰') && (!task.time || !isValidTime(task.time))) return false;
  if (line.includes('⏱️') && (task.duration === undefined || !isValidDuration(task.duration))) {
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

  // Task 51 data-safety net: `start`/`due` are two independent date fields, each individually
  // well-formed per the per-field checks above, but a mutation can still combine them into a
  // semantically-inverted span (`start` after `due`) that no single field's own validity check
  // catches. Root cause this guards against: the timed-grid left-edge resize handle
  // (renderTimedBlocks.ts's attachHorizontalResize) resolves the day the pointer released over
  // via `elementFromPoint` — an ABSOLUTE "whichever day column is under the cursor now"
  // computation, not a delta from the original start — so dragging far enough right of a span's
  // own `due` day produces a `start` after `due` (e.g. `🛫 2026-07-16 📅 2026-07-15`). Both
  // fields round-trip through `parseTask` just fine (each is a real calendar date on its own),
  // so without this check the malformed-but-individually-valid line sailed straight through:
  // `updateTaskStart` (CenterPanel.ts) had no check against `task.due` at all. The result: an
  // inverted span fails every calendar view's span rendering (the same "looks fine as a string,
  // vanishes from every view" class of bug Task 33 first closed for out-of-range time/duration),
  // with the malformed line still silently written to disk. Comparing the raw `YYYY-MM-DD`
  // strings lexicographically is sufficient (no `Date` parsing needed) because both fields are
  // already confirmed real, zero-padded calendar dates by the loop above — lexicographic and
  // chronological order agree exactly for that shape. `start === due` (a legitimate same-day
  // task) is explicitly NOT rejected — only strict `start > due` is.
  if (task.start && task.due && task.start > task.due) return false;

  return true;
}
