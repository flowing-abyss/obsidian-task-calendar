import type { ParseContext, Task, TaskPriority, TaskStatus } from './types';

// Matches task lines: optional indent, "- [char] rest"
const CHECKBOX_RE = /^(\s*)- \[(.)\]\s*(.*)/;

const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const SCHEDULED_RE = /⏳\s*(\d{4}-\d{2}-\d{2})/u;
const START_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/u;
const COMPLETION_RE = /✅\s*(\d{4}-\d{2}-\d{2})/u;
const CANCELLED_EMOJI_RE = /❌\s*(\d{4}-\d{2}-\d{2})/u;
const TIME_RE = /⏰\s*(\d{1,2}:\d{2})/u;
// Recurrence: capture text after 🔁 until another metadata emoji (includes 🔺⏬ for Tasks compat)
const RECURRENCE_RE = /🔁\s*([^📅⏳🛫✅❌⏰🔺⏫🔼🔽⏬\n]*)/u;

const WIKILINK_ALIAS_RE = /\[\[([^|[\]]+)\|[^[\]]+\]\]/gu;
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/gu;
const MD_LINK_RE = /\[([^[\]]+)\]\([^)]+\)/gu;
const BRACKETS_RE = /\[([^[\]]*)\]/gu;
const TAGS_RE = /#[\w/-]+/gu;

export function parseTask(rawText: string, ctx: ParseContext): Task | null {
  const match = CHECKBOX_RE.exec(rawText);
  if (!match) return null;

  const state = match[2];
  const rest = match[3];
  if (rest === undefined) return null;

  let text = rest;

  // Status from checkbox char
  let status: TaskStatus;
  switch (state) {
    case 'x':
    case 'X':
      status = 'done';
      break;
    case '-':
      status = 'cancelled';
      break;
    case '/':
      status = 'in-progress';
      break;
    default:
      status = 'open';
  }

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

  // Collapse links to readable form
  text = text.replace(WIKILINK_ALIAS_RE, '🔗$1');
  text = text.replace(WIKILINK_RE, (_, link: string) => '🔗 ' + link.replace(/\.[^.]*$/u, ''));
  text = text.replace(MD_LINK_RE, '🌐 $1');
  text = text.replace(BRACKETS_RE, '$1');

  // Strip tags
  if (ctx.globalTaskFilter) {
    text = text.split(ctx.globalTaskFilter).join('');
  }
  text = text
    .replace(TAGS_RE, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();

  return {
    filePath: ctx.filePath,
    line: ctx.line,
    rawText,
    text,
    status,
    due,
    scheduled,
    start,
    completion,
    cancelledDate,
    time,
    recurrence,
    priority,
    dailyNoteDate: ctx.dailyNoteDate,
  };
}

// Checkbox prefix including trailing space: "  - [x] "
const FMT_PREFIX_RE = /^(\s*-\s\[[^\]]\]\s)/u;

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
export function formatTaskLine(line: string): string {
  const prefixMatch = FMT_PREFIX_RE.exec(line);
  if (!prefixMatch) return line;
  const prefix = prefixMatch[1] ?? '';
  const rest = line.slice(prefix.length);

  // Extract each metadata field
  const time = /⏰\s*(\d{1,2}:\d{2})/u.exec(rest)?.[1];
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
