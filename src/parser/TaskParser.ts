import type { TaskPriority } from '../tasks/domain/types';
import { durationMinutes, formatDurationMinutes } from '../tasks/domain/validation';
import {
  TaskMarkdownCodec,
  type ParsedTaskLine,
  type SourceSpan,
  type TaskSpanKind,
} from '../tasks/infrastructure/markdown/TaskMarkdownCodec';
import {
  isLegacyTaskRecurrenceSpanConsumed,
  legacyTaskRecurrenceFromParsed,
} from './extractMetadata';
import { collapseLinks } from './links';
import type { ParseContext, Task } from './types';

const DURATION_RE = /⏱️\s*(?:(\d+)h)?(?:(\d+)m)?/u;

const TAGS_RE = /#[\w/-]+/gu;
const PRIORITY_MARKER: Readonly<Record<TaskPriority, string>> = {
  A: '🔺',
  B: '⏫',
  C: '🔼',
  D: '',
  E: '🔽',
  F: '⏬',
};

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
  return formatDurationMinutes(durationMinutes(minutes));
}

/**
 * Find a ⏱️ duration token in `text` and parse it via `parseDurationToMinutes`,
 * the single source of truth for h/m parsing (including the "0m -> undefined"
 * rule). Returns `undefined` when no digit group follows ⏱️ at all (a bare/
 * malformed token) — callers should then treat it as ordinary title text, not
 * metadata, matching `parseTask`'s behavior for malformed input.
 */
function matchDuration(text: string): { raw: string; minutes: number | undefined } | undefined {
  const m = DURATION_RE.exec(text);
  if (!m || (!m[1] && !m[2])) return undefined;
  const parts: string[] = [];
  if (m[1]) parts.push(`${m[1]}h`);
  if (m[2]) parts.push(`${m[2]}m`);
  return { raw: m[0], minutes: parseDurationToMinutes(parts.join('')) };
}

export function parseTask(rawText: string, ctx: ParseContext): Task | null {
  const codec = new TaskMarkdownCodec(ctx.statusCatalog);
  const parsed = codec.parseLine(rawText, { filePath: ctx.filePath, line: ctx.line });
  if (!parsed) return null;

  const markdownText = compatibilityMarkdownTitle(parsed, ctx.globalTaskFilter);
  const text = collapseLinks(markdownText);
  let status = codec.statusForSymbol(parsed.statusSymbol);
  if (parsed.planning.cancelled !== undefined) status = 'cancelled';

  return {
    filePath: ctx.filePath,
    line: ctx.line,
    rawText,
    text,
    markdownText,
    status,
    statusSymbol: parsed.statusSymbol,
    due: parsed.planning.due,
    scheduled: parsed.planning.scheduled,
    start: parsed.planning.start,
    completion: parsed.planning.completion,
    cancelledDate: parsed.planning.cancelled,
    time: parsed.planning.time,
    duration: parsed.planning.duration,
    recurrence: legacyTaskRecurrenceFromParsed(parsed),
    priority: parsed.priority,
    dailyNoteDate: ctx.dailyNoteDate,
  };
}

const FIRST_ONLY_KINDS = new Set<TaskSpanKind>([
  'due',
  'scheduled',
  'start',
  'completion',
  'cancelled',
  'time',
  'duration',
]);

function compatibilityMarkdownTitle(
  parsed: ParsedTaskLine,
  globalTaskFilter: string | undefined,
): string {
  const firstByKind = new Map<TaskSpanKind, SourceSpan>();
  for (const span of parsed.spans) {
    if (!firstByKind.has(span.kind)) firstByKind.set(span.kind, span);
  }

  let markdown = parsed.spans
    .map((span) => {
      if (span.kind === 'prefix') return '';
      if (span.kind === 'tag') return parsed.original.slice(span.from, span.to);
      if (isLegacyTaskRecurrenceSpanConsumed(parsed, span)) return '';
      if (FIRST_ONLY_KINDS.has(span.kind)) {
        return firstByKind.get(span.kind) === span ? '' : parsed.original.slice(span.from, span.to);
      }
      if (span.kind === 'priority') {
        const marker = parsed.original.slice(span.from, span.to);
        return marker === PRIORITY_MARKER[parsed.priority] ? '' : marker;
      }
      return parsed.original.slice(span.from, span.to);
    })
    .join('');

  if (globalTaskFilter) markdown = markdown.split(globalTaskFilter).join('');
  return markdown
    .replace(TAGS_RE, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
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
  const durationMatch = matchDuration(rest);
  const durationMinutes = durationMatch?.minutes;
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

  // Strip all recognized metadata to isolate the title. Duration is only
  // stripped when matchDuration recognized a valid token (has digits) — a
  // bare/malformed ⏱️ with no digits is left in place, matching parseTask's
  // treatment of malformed duration input as ordinary title text.
  const restWithoutDuration = durationMatch ? rest.replace(durationMatch.raw, '') : rest;
  const title = restWithoutDuration
    .replace(/⏰\s*\d{1,2}:\d{2}/gu, '')
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
