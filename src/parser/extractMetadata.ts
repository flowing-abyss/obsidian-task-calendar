import type { TaskPriority } from '../tasks/domain/types';

const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const SCHEDULED_RE = /⏳\s*(\d{4}-\d{2}-\d{2})/u;
const START_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/u;
const COMPLETION_RE = /✅\s*(\d{4}-\d{2}-\d{2})/u;
const CANCELLED_EMOJI_RE = /❌\s*(\d{4}-\d{2}-\d{2})/u;
const TIME_RE = /⏰\s*(\d{1,2}:\d{2})/u;
const RECURRENCE_RE = /🔁\s*([^📅⏳🛫✅❌⏰🔺⏫🔼🔽⏬\n]*)/u;
const TAGS_RE = /#[\w/-]+/gu;

export interface ExtractedMetadata {
  due?: string;
  scheduled?: string;
  start?: string;
  completion?: string;
  cancelledDate?: string;
  time?: string;
  recurrence?: string;
  priority: TaskPriority;
  cleanText: string;
}

export function extractMetadata(text: string): ExtractedMetadata {
  let t = text;
  let due: string | undefined;
  let scheduled: string | undefined;
  let start: string | undefined;
  let completion: string | undefined;
  let cancelledDate: string | undefined;
  let time: string | undefined;
  let recurrence: string | undefined;
  let priority: TaskPriority = 'D';

  const dueMatch = DUE_RE.exec(t);
  if (dueMatch) {
    due = dueMatch[1];
    t = t.replace(dueMatch[0], '');
  }

  const scheduledMatch = SCHEDULED_RE.exec(t);
  if (scheduledMatch) {
    scheduled = scheduledMatch[1];
    t = t.replace(scheduledMatch[0], '');
  }

  const startMatch = START_RE.exec(t);
  if (startMatch) {
    start = startMatch[1];
    t = t.replace(startMatch[0], '');
  }

  const completionMatch = COMPLETION_RE.exec(t);
  if (completionMatch) {
    completion = completionMatch[1];
    t = t.replace(completionMatch[0], '');
  }

  const cancelledMatch = CANCELLED_EMOJI_RE.exec(t);
  if (cancelledMatch) {
    cancelledDate = cancelledMatch[1];
    t = t.replace(cancelledMatch[0], '');
  }

  const timeMatch = TIME_RE.exec(t);
  if (timeMatch) {
    time = timeMatch[1];
    t = t.replace(timeMatch[0], '');
  }

  const recurrenceMatch = RECURRENCE_RE.exec(t);
  if (recurrenceMatch) {
    recurrence = (recurrenceMatch[1] ?? '').trim() || undefined;
    t = t.replace(recurrenceMatch[0], '');
  }

  if (/🔺/u.test(t)) {
    priority = 'A';
    t = t.replace(/🔺/gu, '');
  } else if (/⏫/u.test(t)) {
    priority = 'B';
    t = t.replace(/⏫/gu, '');
  } else if (/🔼/u.test(t)) {
    priority = 'C';
    t = t.replace(/🔼/gu, '');
  } else if (/🔽/u.test(t)) {
    priority = 'E';
    t = t.replace(/🔽/gu, '');
  } else if (/⏬/u.test(t)) {
    priority = 'F';
    t = t.replace(/⏬/gu, '');
  }

  const cleanText = t
    .replace(TAGS_RE, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();

  return {
    due,
    scheduled,
    start,
    completion,
    cancelledDate,
    time,
    recurrence,
    priority,
    cleanText,
  };
}
