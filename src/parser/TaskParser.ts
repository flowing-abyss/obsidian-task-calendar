import { buildDefaultTaskStatuses } from '../settings/defaults';
import { StatusRegistry } from '../status/StatusRegistry';
import { collapseLinks } from './links';
import type { ParseContext, Task, TaskPriority, TaskStatus } from './types';

const DEFAULT_REGISTRY = new StatusRegistry(buildDefaultTaskStatuses());

// Matches task lines: optional indent and blockquote/callout markers (spaces, tabs,
// and `>`), then "- [char] rest". The `[\s>]*` prefix lets tasks inside blockquotes
// and callouts (`> - [ ]`, `> > - [ ]`) parse like plain list tasks.
const CHECKBOX_RE = /^([\s>]*)- \[(.)\]\s*(.*)/;

const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const SCHEDULED_RE = /⏳\s*(\d{4}-\d{2}-\d{2})/u;
const START_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/u;
const COMPLETION_RE = /✅\s*(\d{4}-\d{2}-\d{2})/u;
const CANCELLED_EMOJI_RE = /❌\s*(\d{4}-\d{2}-\d{2})/u;
const TIME_RE = /⏰\s*(\d{1,2}:\d{2})/u;
// Recurrence: capture text after 🔁 until another metadata emoji (includes 🔺⏬ for Tasks compat)
const RECURRENCE_RE = /🔁\s*([^📅⏳🛫✅❌⏰🔺⏫🔼🔽⏬\n]*)/u;
const DURATION_RE = /⏱️\s*(?:(\d+)h)?(?:(\d+)m)?/u;

const TAGS_RE = /#[\w/-]+/gu;

/** Parse a duration token body (e.g. "1h30m", "2h", "45m") into total minutes. */
export function parseDurationToMinutes(raw: string): number | undefined {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/u.exec(raw.trim());
  if (!m) return undefined;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const total = hours * 60 + mins;
  return total > 0 ? total : undefined;
}

/** Format total minutes into the shortest "XhYm" form (e.g. 90 -> "1h30m", 120 -> "2h", 45 -> "45m"). */
export function formatDurationFromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function parseTask(rawText: string, ctx: ParseContext): Task | null {
  const match = CHECKBOX_RE.exec(rawText);
  if (!match) return null;

  const state = match[2] ?? '';
  const rest = match[3];
  if (rest === undefined) return null;

  let text = rest;

  // Status from checkbox char, resolved via the status registry
  const statusSymbol = state;
  const registry = ctx.statusRegistry ?? DEFAULT_REGISTRY;
  // typeForSymbol folds 'X' -> 'x' internally; statusSymbol keeps the raw glyph.
  let status: TaskStatus = registry.typeForSymbol(state);

  // Extract and strip emoji metadata
  let due: string | undefined;
  let scheduled: string | undefined;
  let start: string | undefined;
  let completion: string | undefined;
  let cancelledDate: string | undefined;
  let time: string | undefined;
  let recurrence: string | undefined;
  let priority: TaskPriority = 'D';

  const dueMatch = DUE_RE.exec(text);
  if (dueMatch) {
    due = dueMatch[1];
    text = text.replace(dueMatch[0], '');
  }

  const scheduledMatch = SCHEDULED_RE.exec(text);
  if (scheduledMatch) {
    scheduled = scheduledMatch[1];
    text = text.replace(scheduledMatch[0], '');
  }

  const startMatch = START_RE.exec(text);
  if (startMatch) {
    start = startMatch[1];
    text = text.replace(startMatch[0], '');
  }

  const completionMatch = COMPLETION_RE.exec(text);
  if (completionMatch) {
    completion = completionMatch[1];
    text = text.replace(completionMatch[0], '');
  }

  const cancelledMatch = CANCELLED_EMOJI_RE.exec(text);
  if (cancelledMatch) {
    cancelledDate = cancelledMatch[1];
    status = 'cancelled';
    text = text.replace(cancelledMatch[0], '');
  }

  const timeMatch = TIME_RE.exec(text);
  if (timeMatch) {
    time = timeMatch[1];
    text = text.replace(timeMatch[0], '');
  }

  let duration: number | undefined;
  const durationMatch = DURATION_RE.exec(text);
  if (durationMatch && (durationMatch[1] || durationMatch[2])) {
    const h = durationMatch[1] ? parseInt(durationMatch[1], 10) : 0;
    const m = durationMatch[2] ? parseInt(durationMatch[2], 10) : 0;
    duration = h * 60 + m;
    text = text.replace(durationMatch[0], '');
  }

  const recurrenceMatch = RECURRENCE_RE.exec(text);
  if (recurrenceMatch) {
    recurrence = (recurrenceMatch[1] ?? '').trim() || undefined;
    text = text.replace(recurrenceMatch[0], '');
  }

  // Priority emoji — all five Tasks-plugin levels mapped to A–F (D = normal/none).
  if (/🔺/u.test(text)) {
    priority = 'A';
    text = text.replace(/🔺/gu, '');
  } else if (/⏫/u.test(text)) {
    priority = 'B';
    text = text.replace(/⏫/gu, '');
  } else if (/🔼/u.test(text)) {
    priority = 'C';
    text = text.replace(/🔼/gu, '');
  } else if (/🔽/u.test(text)) {
    priority = 'E';
    text = text.replace(/🔽/gu, '');
  } else if (/⏬/u.test(text)) {
    priority = 'F';
    text = text.replace(/⏬/gu, '');
  }

  // Strip tags
  if (ctx.globalTaskFilter) {
    text = text.split(ctx.globalTaskFilter).join('');
  }
  const markdownText = text
    .replace(TAGS_RE, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
  text = collapseLinks(markdownText);

  return {
    filePath: ctx.filePath,
    line: ctx.line,
    rawText,
    text,
    markdownText,
    status,
    statusSymbol,
    due,
    scheduled,
    start,
    completion,
    cancelledDate,
    time,
    duration,
    recurrence,
    priority,
    dailyNoteDate: ctx.dailyNoteDate,
  };
}

// Checkbox prefix including trailing space and any blockquote/callout markers:
// "  - [x] ", "> - [x] ", "> > - [x] ".
const FMT_PREFIX_RE = /^([\s>]*-\s\[[^\]]\]\s)/u;

/**
 * Rewrite a raw task line so its metadata emojis appear in the canonical order
 * used by the Tasks plugin, with our ⏰ time marker first among all metadata.
 *
 * Canonical order: title · #tags · ⏰ · priority · 🔁 · 🛫 · ⏳ · 📅 · ❌ · ✅
 *
 * Tags are written immediately after the title text (before emoji markers) for
 * readability, but are parsed from anywhere in the line.
 *
 * Created-date (➕) is preserved if present, placed between recurrence and startDate
 * to match Tasks plugin ordering.
 */
/**
 * Insert `insertText` into a task line's title body, before the metadata suffix
 * (dates/priority/time/recurrence/tags), then re-canonicalize via `formatTaskLine`.
 * Returns the line unchanged if it is not a task line. Pure — unit-tested.
 */
export function insertIntoTitleBody(line: string, insertText: string): string {
  const prefixMatch = /^([\s>]*- \[.\] )/u.exec(line);
  if (!prefixMatch) return line;
  const prefix = prefixMatch[1] ?? '';
  const rawAfterPrefix = line.slice(prefix.length);
  const spaceIdx = rawAfterPrefix.search(/\s(?:[📅⏳🛫✅❌⏰🔁🔺⏫🔼🔽⏬#➕]|⏱️)/u);
  const body = (spaceIdx >= 0 ? rawAfterPrefix.slice(0, spaceIdx) : rawAfterPrefix).trimEnd();
  const suffix = spaceIdx >= 0 ? rawAfterPrefix.slice(spaceIdx) : '';
  return formatTaskLine(`${prefix}${body} ${insertText}${suffix}`);
}

export function formatTaskLine(line: string): string {
  const prefixMatch = FMT_PREFIX_RE.exec(line);
  if (!prefixMatch) return line;
  const prefix = prefixMatch[1] ?? '';
  const rest = line.slice(prefix.length);

  // Extract each metadata field
  const time = /⏰\s*(\d{1,2}:\d{2})/u.exec(rest)?.[1];
  const durationMinutes = (() => {
    const m = /⏱️\s*(?:(\d+)h)?(?:(\d+)m)?/u.exec(rest);
    if (!m || (!m[1] && !m[2])) return undefined;
    return (m[1] ? parseInt(m[1], 10) * 60 : 0) + (m[2] ? parseInt(m[2], 10) : 0);
  })();
  // All five Tasks priority levels: 🔺⏫🔼🔽⏬
  const priorityMatch = /([🔺⏫🔼🔽⏬])/u.exec(rest);
  const priority = priorityMatch?.[1];
  const recurrenceMatch = /🔁\s*([^📅⏳🛫✅❌⏰🔺⏫🔼🔽⏬\n]*)/u.exec(rest);
  const recurrence = recurrenceMatch?.[1]?.trim() || undefined;
  const createdDate = /➕\s*(\d{4}-\d{2}-\d{2})/u.exec(rest)?.[1];
  const startDate = /🛫\s*(\d{4}-\d{2}-\d{2})/u.exec(rest)?.[1];
  const scheduledDate = /⏳\s*(\d{4}-\d{2}-\d{2})/u.exec(rest)?.[1];
  const dueDate = /📅\s*(\d{4}-\d{2}-\d{2})/u.exec(rest)?.[1];
  const cancelledDate = /❌\s*(\d{4}-\d{2}-\d{2})/u.exec(rest)?.[1];
  const doneDate = /✅\s*(\d{4}-\d{2}-\d{2})/u.exec(rest)?.[1];
  const tags = Array.from(rest.matchAll(/#[\w/-]+/gu)).map((m) => m[0]);

  // Strip all recognized metadata to isolate the title
  const title = rest
    .replace(/⏰\s*\d{1,2}:\d{2}/gu, '')
    .replace(/⏱️\s*(?:\d+h)?(?:\d+m)?/gu, '')
    .replace(/[🔺⏫🔼🔽⏬]/gu, '')
    .replace(/🔁\s*[^📅⏳🛫✅❌⏰🔺⏫🔼🔽⏬\n]*/gu, '')
    .replace(/➕\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/🛫\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/⏳\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/📅\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/❌\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/✅\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/#[\w/-]+/gu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();

  // Rebuild in canonical order
  const parts: string[] = [title, ...tags];
  if (time) parts.push(`⏰ ${time}`);
  if (durationMinutes !== undefined) parts.push(`⏱️ ${formatDurationFromMinutes(durationMinutes)}`);
  if (priority) parts.push(priority);
  if (recurrence) parts.push(`🔁 ${recurrence}`);
  if (createdDate) parts.push(`➕ ${createdDate}`);
  if (startDate) parts.push(`🛫 ${startDate}`);
  if (scheduledDate) parts.push(`⏳ ${scheduledDate}`);
  if (dueDate) parts.push(`📅 ${dueDate}`);
  if (cancelledDate) parts.push(`❌ ${cancelledDate}`);
  if (doneDate) parts.push(`✅ ${doneDate}`);

  return prefix + parts.filter(Boolean).join(' ');
}
