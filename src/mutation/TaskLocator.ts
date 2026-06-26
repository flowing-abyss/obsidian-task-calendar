/**
 * A stable task identifier that survives line-number drift.
 *
 * `rawText` is the full original line including leading whitespace and all metadata
 * emojis — it acts as a content fingerprint. `line` is a fast-path hint; if the
 * hint no longer matches we fall back to a full scan and resolve by uniqueness.
 */
export interface TaskLocator {
  filePath: string;
  rawText: string;
  line: number;
}

export type FindResult =
  | { type: 'found'; line: number }
  | { type: 'not-found' }
  | { type: 'ambiguous'; candidates: number[] };

/**
 * Locate the actual current line of a task inside a split file content array.
 *
 * Resolution order:
 * 1. Fast path: `lines[locator.line] === locator.rawText` → found.
 * 2. Full scan for all lines equal to `rawText`:
 *    - exactly one match → found at that line.
 *    - zero matches → not-found.
 *    - two or more matches → ambiguous (identical task text in file).
 *
 * Works correctly for both LF and CRLF files: `lines` must come from
 * `content.split('\n')`, which preserves trailing `\r` consistently with
 * how `rawText` was captured during parsing.
 */
export function findTaskLine(lines: string[], locator: TaskLocator): FindResult {
  if (lines[locator.line] === locator.rawText) {
    return { type: 'found', line: locator.line };
  }

  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === locator.rawText) matches.push(i);
  }

  if (matches.length === 1) return { type: 'found', line: matches[0]! };
  if (matches.length === 0) return { type: 'not-found' };
  return { type: 'ambiguous', candidates: matches };
}

/** Build a locator from a Task or SubTask (both carry filePath, line, rawText). */
export function locatorOf(task: { filePath: string; line: number; rawText: string }): TaskLocator {
  return { filePath: task.filePath, rawText: task.rawText, line: task.line };
}
