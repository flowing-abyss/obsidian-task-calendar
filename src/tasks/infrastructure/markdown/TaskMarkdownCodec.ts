import { StatusCatalog } from '../../domain/StatusCatalog';
import type { TaskPriority, TaskStatus } from '../../domain/types';

export type TaskSpanKind =
  | 'prefix'
  | 'title'
  | 'tag'
  | 'priority'
  | 'recurrence'
  | 'created'
  | 'start'
  | 'scheduled'
  | 'due'
  | 'completion'
  | 'cancelled'
  | 'time'
  | 'duration'
  | 'task-id'
  | 'depends-on'
  | 'block-id'
  | 'separator'
  | 'unknown';

export interface SourceSpan {
  readonly kind: TaskSpanKind;
  readonly from: number;
  readonly to: number;
}

export interface ParsedTaskLine {
  readonly original: string;
  readonly lineEnding: '' | '\n' | '\r\n';
  readonly statusSymbol: string;
  readonly markdownTitle: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly spans: readonly SourceSpan[];
  readonly occurrences: ReadonlyMap<TaskSpanKind, readonly SourceSpan[]>;
  readonly planning: {
    readonly due?: string;
    readonly scheduled?: string;
    readonly start?: string;
    readonly completion?: string;
    readonly cancelled?: string;
    readonly time?: string;
    readonly duration?: number;
  };
  readonly priority: TaskPriority;
  readonly recurrence?: string;
  readonly source: {
    readonly filePath: string;
    readonly line: number;
    readonly originalMarkdown: string;
  };
}

interface ParseSource {
  readonly filePath: string;
  readonly line: number;
}

interface Candidate extends SourceSpan {
  readonly value?: string | number;
}

const TASK_LINE_RE = /^[\s>]*- \[(.)\]/u;
const TAG_RE = /#[\w/-]+/gu;
const PRIORITY_RE = /[🔺⏫🔼🔽⏬]/gu;
const DATE_PATTERNS: ReadonlyArray<{
  kind: 'created' | 'start' | 'scheduled' | 'due' | 'completion' | 'cancelled';
  regex: RegExp;
}> = [
  { kind: 'created', regex: /➕\s*(\d{4}-\d{2}-\d{2})/gu },
  { kind: 'start', regex: /🛫\s*(\d{4}-\d{2}-\d{2})/gu },
  { kind: 'scheduled', regex: /⏳\s*(\d{4}-\d{2}-\d{2})/gu },
  { kind: 'due', regex: /📅\s*(\d{4}-\d{2}-\d{2})/gu },
  { kind: 'completion', regex: /✅\s*(\d{4}-\d{2}-\d{2})/gu },
  { kind: 'cancelled', regex: /❌\s*(\d{4}-\d{2}-\d{2})/gu },
];
const TIME_RE = /⏰\s*(\d{1,2}:\d{2})/gu;
const DURATION_RE = /⏱️\s*(?:(\d+)h)?(?:(\d+)m)?/gu;
const RECURRENCE_MARKER_RE = /🔁/gu;
const BLOCK_ID_RE = /\^[A-Za-z0-9-]+(?=\s*$)/gu;

const TASK_ID = '[A-Za-z0-9_-]+';
const TASK_ID_SEQUENCE = `${TASK_ID}( *, *${TASK_ID} *)*`;
const TASK_ID_RE = new RegExp(`🆔\\uFE0F? *(${TASK_ID})(?=$|\\s)`, 'u');
const DEPENDS_ON_RE = new RegExp(`⛔\\uFE0F? *(${TASK_ID_SEQUENCE})(?=$|\\s)`, 'u');

const METADATA_KINDS = new Set<TaskSpanKind>([
  'priority',
  'recurrence',
  'created',
  'start',
  'scheduled',
  'due',
  'completion',
  'cancelled',
  'time',
  'duration',
  'task-id',
  'depends-on',
  'block-id',
]);

const PRIORITY_BY_MARKER: Readonly<Record<string, TaskPriority>> = {
  '🔺': 'A',
  '⏫': 'B',
  '🔼': 'C',
  '🔽': 'E',
  '⏬': 'F',
};

const PRIORITY_PRECEDENCE: readonly TaskPriority[] = ['A', 'B', 'C', 'E', 'F'];
const UNKNOWN_PICTOGRAPH_RE = /\p{Extended_Pictographic}/u;
const WIKILINK_ALIAS_RE = /\[\[([^|[\]]+)\|([^[\]]+)\]\]/gu;
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/gu;
const MD_LINK_RE = /\[([^[\]]+)\]\(([^)]+)\)/gu;
const BRACKETS_RE = /\[([^[\]]*)\]/gu;

function matches(regex: RegExp, text: string): RegExpExecArray[] {
  regex.lastIndex = 0;
  const result: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) result.push(match);
  return result;
}

function pushPatternCandidates(
  candidates: Candidate[],
  body: string,
  bodyFrom: number,
  kind: TaskSpanKind,
  regex: RegExp,
  valueGroup?: number,
): void {
  for (const match of matches(regex, body)) {
    if (match[0].length === 0) continue;
    candidates.push({
      kind,
      from: bodyFrom + match.index,
      to: bodyFrom + match.index + match[0].length,
      ...(valueGroup !== undefined && match[valueGroup] !== undefined
        ? { value: match[valueGroup] }
        : {}),
    });
  }
}

function pushPinnedCarrierCandidates(
  candidates: Candidate[],
  body: string,
  bodyFrom: number,
  marker: '🆔' | '⛔',
  regex: RegExp,
  kind: 'task-id' | 'depends-on',
): void {
  let searchFrom = 0;
  while (searchFrom < body.length) {
    const markerAt = body.indexOf(marker, searchFrom);
    if (markerAt < 0) break;
    const match = regex.exec(body.slice(markerAt));
    if (match?.index === 0) {
      candidates.push({
        kind,
        from: bodyFrom + markerAt,
        to: bodyFrom + markerAt + match[0].length,
        value: match[1],
      });
    }
    searchFrom = markerAt + marker.length;
  }
}

function durationMinutes(
  hours: string | undefined,
  minutes: string | undefined,
): number | undefined {
  if (hours === undefined && minutes === undefined) return undefined;
  const total = Number(hours ?? 0) * 60 + Number(minutes ?? 0);
  return total > 0 ? total : undefined;
}

function addGapSpans(spans: SourceSpan[], original: string, from: number, to: number): void {
  let cursor = from;
  while (cursor < to) {
    const whitespace = /\s/u.test(original[cursor] ?? '');
    let end = cursor + 1;
    while (end < to && /\s/u.test(original[end] ?? '') === whitespace) end++;
    if (whitespace) {
      spans.push({ kind: 'separator', from: cursor, to: end });
      cursor = end;
      continue;
    }

    const raw = original.slice(cursor, end);
    spans.push({
      kind: UNKNOWN_PICTOGRAPH_RE.test(raw) ? 'unknown' : 'title',
      from: cursor,
      to: end,
    });
    cursor = end;
  }
}

function collapseLinks(input: string): string {
  return input
    .replace(WIKILINK_ALIAS_RE, '🔗$1')
    .replace(WIKILINK_RE, (_match, link: string) => '🔗 ' + link.replace(/\.[^.]*$/u, ''))
    .replace(MD_LINK_RE, '🌐 $1')
    .replace(BRACKETS_RE, '$1');
}

function firstString(candidates: readonly Candidate[], kind: TaskSpanKind): string | undefined {
  const value = candidates.find((candidate) => candidate.kind === kind)?.value;
  return typeof value === 'string' ? value : undefined;
}

function lineEndingOf(original: string): ParsedTaskLine['lineEnding'] {
  if (original.endsWith('\r\n')) return '\r\n';
  if (original.endsWith('\n')) return '\n';
  return '';
}

function pushBlockIdCandidates(candidates: Candidate[], body: string, bodyFrom: number): void {
  for (const match of matches(BLOCK_ID_RE, body)) {
    const before = body[match.index - 1];
    if (match.index === 0 || before === undefined || !/\s/u.test(before)) continue;
    candidates.push({
      kind: 'block-id',
      from: bodyFrom + match.index,
      to: bodyFrom + match.index + match[0].length,
    });
  }
}

export class TaskMarkdownCodec {
  constructor(private readonly statusCatalog: StatusCatalog) {}

  statusForSymbol(symbol: string): TaskStatus {
    return this.statusCatalog.statusForSymbol(symbol);
  }

  parseLine(original: string, source: ParseSource): ParsedTaskLine | null {
    const lineEnding = lineEndingOf(original);
    const contentEnd = original.length - lineEnding.length;
    const content = original.slice(0, contentEnd);
    const taskMatch = TASK_LINE_RE.exec(content);
    if (!taskMatch) return null;

    const statusSymbol = taskMatch[1] ?? '';
    const prefixEnd = taskMatch[0].length;
    const body = content.slice(prefixEnd);
    const candidates: Candidate[] = [];

    for (const pattern of DATE_PATTERNS) {
      pushPatternCandidates(candidates, body, prefixEnd, pattern.kind, pattern.regex, 1);
    }
    pushPatternCandidates(candidates, body, prefixEnd, 'tag', TAG_RE);
    pushPatternCandidates(candidates, body, prefixEnd, 'priority', PRIORITY_RE);
    pushPatternCandidates(candidates, body, prefixEnd, 'time', TIME_RE, 1);
    pushBlockIdCandidates(candidates, body, prefixEnd);
    pushPinnedCarrierCandidates(candidates, body, prefixEnd, '🆔', TASK_ID_RE, 'task-id');
    pushPinnedCarrierCandidates(candidates, body, prefixEnd, '⛔', DEPENDS_ON_RE, 'depends-on');

    for (const match of matches(DURATION_RE, body)) {
      if (match[1] === undefined && match[2] === undefined) continue;
      candidates.push({
        kind: 'duration',
        from: prefixEnd + match.index,
        to: prefixEnd + match.index + match[0].length,
        ...(durationMinutes(match[1], match[2]) !== undefined
          ? { value: durationMinutes(match[1], match[2]) }
          : {}),
      });
    }

    const recurrenceMarkers = matches(RECURRENCE_MARKER_RE, body).map(
      (match) => prefixEnd + match.index,
    );
    for (let i = recurrenceMarkers.length - 1; i >= 0; i--) {
      const from = recurrenceMarkers[i];
      if (from === undefined) continue;
      const nextBoundary = [
        ...candidates,
        ...recurrenceMarkers.slice(i + 1).map((at) => ({ from: at })),
      ]
        .map((candidate) => candidate.from)
        .filter((candidateFrom) => candidateFrom > from)
        .sort((a, b) => a - b)[0];
      const to = nextBoundary ?? contentEnd;
      const rawValue = original.slice(from + '🔁'.length, to).trim();
      candidates.push({
        kind: 'recurrence',
        from,
        to,
        ...(rawValue ? { value: rawValue } : {}),
      });
    }

    candidates.sort((left, right) => left.from - right.from || left.to - right.to);
    const accepted: Candidate[] = [];
    let acceptedTo = prefixEnd;
    for (const candidate of candidates) {
      if (candidate.from < acceptedTo || candidate.to > contentEnd) continue;
      accepted.push(candidate);
      acceptedTo = candidate.to;
    }

    const spans: SourceSpan[] = [{ kind: 'prefix', from: 0, to: prefixEnd }];
    let cursor = prefixEnd;
    for (const candidate of accepted) {
      addGapSpans(spans, original, cursor, candidate.from);
      spans.push({ kind: candidate.kind, from: candidate.from, to: candidate.to });
      cursor = candidate.to;
    }
    addGapSpans(spans, original, cursor, contentEnd);
    if (lineEnding) spans.push({ kind: 'separator', from: contentEnd, to: original.length });

    const occurrences = new Map<TaskSpanKind, SourceSpan[]>();
    for (const span of spans) {
      const group = occurrences.get(span.kind) ?? [];
      group.push(span);
      occurrences.set(span.kind, group);
    }

    const markdownTitle = spans
      .map((span) => {
        if (span.kind === 'prefix' || span.kind === 'tag' || METADATA_KINDS.has(span.kind))
          return '';
        if (lineEnding && span.from === contentEnd) return '';
        return original.slice(span.from, span.to);
      })
      .join('')
      .replace(/\s{2,}/gu, ' ')
      .trim();

    const priorityCandidates = accepted
      .filter((candidate) => candidate.kind === 'priority')
      .map((candidate) => PRIORITY_BY_MARKER[original.slice(candidate.from, candidate.to)])
      .filter((priority): priority is TaskPriority => priority !== undefined);
    const priority =
      PRIORITY_PRECEDENCE.find((candidate) => priorityCandidates.includes(candidate)) ?? 'D';

    const firstDuration = accepted.find((candidate) => candidate.kind === 'duration');
    const duration =
      firstDuration && typeof firstDuration.value === 'number' ? firstDuration.value : undefined;
    const planning: ParsedTaskLine['planning'] = {
      ...(firstString(accepted, 'due') !== undefined && { due: firstString(accepted, 'due') }),
      ...(firstString(accepted, 'scheduled') !== undefined && {
        scheduled: firstString(accepted, 'scheduled'),
      }),
      ...(firstString(accepted, 'start') !== undefined && {
        start: firstString(accepted, 'start'),
      }),
      ...(firstString(accepted, 'completion') !== undefined && {
        completion: firstString(accepted, 'completion'),
      }),
      ...(firstString(accepted, 'cancelled') !== undefined && {
        cancelled: firstString(accepted, 'cancelled'),
      }),
      ...(firstString(accepted, 'time') !== undefined && { time: firstString(accepted, 'time') }),
      ...(typeof duration === 'number' && { duration }),
    };

    return {
      original,
      lineEnding,
      statusSymbol,
      markdownTitle,
      title: collapseLinks(markdownTitle),
      tags: accepted
        .filter((candidate) => candidate.kind === 'tag')
        .map((candidate) => original.slice(candidate.from, candidate.to)),
      spans,
      occurrences,
      planning,
      priority,
      recurrence: firstString(accepted, 'recurrence'),
      source: { ...source, originalMarkdown: original },
    };
  }
}
