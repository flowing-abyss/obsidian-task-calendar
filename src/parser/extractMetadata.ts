import { StatusCatalog } from '../tasks/domain/StatusCatalog';
import type { TaskPriority } from '../tasks/domain/types';
import {
  TaskMarkdownCodec,
  type ParsedTaskLine,
  type SourceSpan,
  type TaskSpanKind,
} from '../tasks/infrastructure/markdown/TaskMarkdownCodec';

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

const CODEC = new TaskMarkdownCodec(new StatusCatalog([]));
const SYNTHETIC_PREFIX = '- [ ] ';
const PRIORITY_MARKER: Readonly<Record<TaskPriority, string>> = {
  A: '🔺',
  B: '⏫',
  C: '🔼',
  D: '',
  E: '🔽',
  F: '⏬',
};
const LEGACY_REMOVED_BEFORE_RECURRENCE = new Set<TaskSpanKind>([
  'due',
  'scheduled',
  'start',
  'completion',
  'cancelled',
  'time',
]);

/** Reproduce the old extractor's recurrence value from the codec's lossless spans. */
export function legacyRecurrenceFromParsed(parsed: ParsedTaskLine): string | undefined {
  const recurrence = parsed.occurrences.get('recurrence')?.[0];
  if (!recurrence) return undefined;

  const firstByKind = new Map<TaskSpanKind, SourceSpan>();
  for (const span of parsed.spans) {
    if (!firstByKind.has(span.kind)) firstByKind.set(span.kind, span);
  }

  let value = parsed.original.slice(recurrence.from + '🔁'.length, recurrence.to);
  for (const span of parsed.spans) {
    if (span.from < recurrence.to) continue;
    if (span.kind === 'priority') break;
    if (LEGACY_REMOVED_BEFORE_RECURRENCE.has(span.kind)) {
      if (firstByKind.get(span.kind) === span) continue;
      break;
    }
    value += parsed.original.slice(span.from, span.to);
  }
  return value.trim() || undefined;
}

function legacyCleanText(parsed: ParsedTaskLine): string {
  const firstByKind = new Map<TaskSpanKind, SourceSpan>();
  for (const span of parsed.spans) {
    if (!firstByKind.has(span.kind)) firstByKind.set(span.kind, span);
  }

  return parsed.spans
    .map((span) => {
      if (span.kind === 'prefix' || span.kind === 'tag') return '';
      if (LEGACY_REMOVED_BEFORE_RECURRENCE.has(span.kind) || span.kind === 'recurrence') {
        return firstByKind.get(span.kind) === span ? '' : parsed.original.slice(span.from, span.to);
      }
      if (span.kind === 'priority') {
        const marker = parsed.original.slice(span.from, span.to);
        return marker === PRIORITY_MARKER[parsed.priority] ? '' : marker;
      }
      return parsed.original.slice(span.from, span.to);
    })
    .join('')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

/** Compatibility projection for legacy callers that parse a task title body. */
export function extractMetadata(text: string): ExtractedMetadata {
  const parsed = CODEC.parseLine(SYNTHETIC_PREFIX + text, { filePath: '', line: 0 });
  if (!parsed) return { priority: 'D', cleanText: text };

  return {
    due: parsed.planning.due,
    scheduled: parsed.planning.scheduled,
    start: parsed.planning.start,
    completion: parsed.planning.completion,
    cancelledDate: parsed.planning.cancelled,
    time: parsed.planning.time,
    recurrence: legacyRecurrenceFromParsed(parsed),
    priority: parsed.priority,
    cleanText: legacyCleanText(parsed),
  };
}
