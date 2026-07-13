import { Notice, TFile, type App } from 'obsidian';
import type { ParseContext } from '../parser/types';
import { PRIORITY_LEVELS } from '../priority';
import type { StatusRegistry } from '../status/StatusRegistry';
import type { StatusCatalog } from '../tasks/domain/StatusCatalog';
import type { TaskPriority } from '../tasks/domain/types';
import { insertTaskBlockIntoContent } from './insertTaskBlock';
import { findTaskLine, type FindResult, type TaskLocator } from './TaskLocator';
import { validateMutatedTaskLine } from './validateMutatedLine';

/**
 * The line range `[start, end]` (inclusive) covering a task and its indented
 * sub-item block. Block end is found by an indentation/quote-depth scan on the
 * live content, so it is robust to lines inserted or removed inside the block.
 *
 * Leading prefix includes blockquote/callout markers (`>`) so a quoted child
 * (`> \t- [ ]`) measures as deeper than its quoted parent (`> - [ ]`), and a
 * differing quote depth marks a separate block (a sibling container).
 */
function taskBlockRange(lines: string[], taskLine: number): [number, number] {
  const prefixOf = (s: string) => /^[\s>]*/.exec(s)?.[0] ?? '';
  const indentOf = (s: string) => prefixOf(s).replace(/\t/g, '    ').length;
  const quoteOf = (s: string) => {
    let depth = 0;
    for (const ch of prefixOf(s)) if (ch === '>') depth++;
    return depth;
  };
  const taskLineStr = lines[taskLine] ?? '';
  const taskIndent = indentOf(taskLineStr);
  const taskQuote = quoteOf(taskLineStr);
  let blockEnd = taskLine;
  for (let i = taskLine + 1; i < lines.length; i++) {
    const lineStr = lines[i] ?? '';
    // A quote-only line (">", "> ") is "blank" inside a blockquote — absorb it.
    const isBlank = /^[\s>]*$/u.test(lineStr);
    // A non-blank line ends the block once it leaves the parent's quote depth or
    // is no longer more indented than the parent.
    if (!isBlank && (quoteOf(lineStr) !== taskQuote || indentOf(lineStr) <= taskIndent)) break;
    blockEnd = i;
  }
  return [taskLine, blockEnd];
}

export type MutationResult =
  | { type: 'ok' }
  | { type: 'file-not-found' }
  | { type: 'not-found' }
  | { type: 'ambiguous'; candidates: number[] };

/**
 * Single point-of-truth for all Markdown task mutations.
 *
 * Every write goes through `applyToLines`. The callback receives the *current*
 * file content (inside `vault.process`) so line-number drift from external edits
 * is detected and handled before any write occurs. If the task cannot be located
 * unambiguously, the file is left unchanged and a structured error is returned.
 */
export class TaskMutationService {
  constructor(
    private app: App,
    private getRegistry: (() => StatusRegistry) | undefined,
    private getStatusCatalog: () => StatusCatalog,
  ) {}

  private static stripStamp(line: string, emoji: string): string {
    return line.replace(new RegExp(`\\s*${emoji}\\s*\\d{4}-\\d{2}-\\d{2}`, 'u'), '');
  }

  private static addStamp(line: string, emoji: string, date: string, cr: string): string {
    const body = (cr ? line.slice(0, -cr.length) : line).trimEnd();
    return `${body} ${emoji} ${date}${cr}`;
  }

  /**
   * Locate the task in the current file content and call `transform(lines, taskLine)`.
   * The transform mutates `lines` in place; the service reassembles and writes back.
   *
   * Returns a `MutationResult`. On `not-found` or `ambiguous`, shows a Notice and
   * leaves the file unchanged.
   */
  async applyToLines(
    locator: TaskLocator,
    transform: (lines: string[], taskLine: number) => void,
  ): Promise<MutationResult> {
    const file = this.app.vault.getAbstractFileByPath(locator.filePath);
    if (!(file instanceof TFile)) {
      new Notice('Task file not found: ' + locator.filePath);
      return { type: 'file-not-found' };
    }

    // Use a box so TypeScript doesn't narrow the closure assignment away.
    const box: { result: MutationResult } = { result: { type: 'ok' } };

    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const found: FindResult = findTaskLine(lines, locator);

      if (found.type === 'not-found') {
        box.result = { type: 'not-found' };
        return data;
      }
      if (found.type === 'ambiguous') {
        box.result = { type: 'ambiguous', candidates: found.candidates };
        return data;
      }

      transform(lines, found.line);
      return lines.join('\n');
    });

    if (box.result.type === 'not-found') {
      new Notice('Could not update task: it may have been moved or deleted.');
    } else if (box.result.type === 'ambiguous') {
      new Notice('Could not update task: multiple identical tasks found in the file.');
    }

    return box.result;
  }

  /** Replace the task line with a pre-built new line. */
  async replaceTaskLine(locator: TaskLocator, newLine: string): Promise<MutationResult> {
    return this.applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = newLine;
    });
  }

  /**
   * Task 33 data-safety net: same contract as `applyToLines`, except `build` *proposes* a
   * replacement line (returned, not written directly) which is re-parsed and validated
   * (`validateMutatedTaskLine`) before it is ever committed to disk.
   *
   * Every drag/resize-triggered mutation in this project (reschedule, drop-to-time, time change,
   * duration change, start/due edge-resize, extend-to-span) goes through this instead of the raw
   * `applyToLines` it used to call directly. Root cause this closes: a drag gesture can compute an
   * out-of-range value (e.g. dragging a timed block far enough that the resulting start time has
   * a 3-digit hour like "2093:15") which `formatTaskLine`'s own metadata regexes silently fail to
   * round-trip — the field comes back `undefined` even though the garbage token is still in the
   * text, and the task quietly vanishes from every time-based view. If `build`'s result fails
   * validation, the ORIGINAL line is left completely untouched (never written) and a `Notice`
   * explains the drag could not be completed — a dropped/failed drag must never silently corrupt
   * or delete a task, regardless of what future edge case triggers it.
   */
  async applyValidatedLineMutation(
    locator: TaskLocator,
    build: (currentLine: string) => string,
  ): Promise<MutationResult> {
    let rejected = false;
    const result = await this.applyToLines(locator, (lines, taskLine) => {
      const current = lines[taskLine];
      if (current === undefined) return;
      const candidate = build(current);
      const ctx: ParseContext = {
        filePath: locator.filePath,
        line: taskLine,
        statusCatalog: this.getStatusCatalog(),
      };
      if (!validateMutatedTaskLine(candidate, ctx)) {
        rejected = true;
        return; // leave `lines[taskLine]` (and hence the on-disk file) completely untouched
      }
      lines[taskLine] = candidate;
    });
    if (rejected) {
      new Notice(
        "Couldn't complete the drag: the result would leave the task's date/time unreadable. The task was left unchanged.",
      );
    }
    return result;
  }

  /**
   * Toggle task completion. Registry-driven: any non-done status becomes the
   * registry's default "done" symbol (✅ stamped), and done becomes the default
   * "to-do" symbol (✅ stripped). Falls back to plain x/space when no registry
   * getter was supplied (mirrors legacy open ↔ done behavior).
   */
  async toggleCompletion(locator: TaskLocator, today: string): Promise<MutationResult> {
    return this.applyToLines(locator, (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const registry = this.getRegistry?.();
      const cur = /^[\s>]*- \[(.)\]/u.exec(line)?.[1] ?? ' ';
      const isDone = registry ? registry.typeForSymbol(cur) === 'done' : cur === 'x' || cur === 'X';
      const target = isDone
        ? (registry?.defaultTodo().symbol ?? ' ')
        : (registry?.defaultDone().symbol ?? 'x');
      // Preserve trailing \r for CRLF files so the rawText fingerprint stays consistent.
      const cr = line.endsWith('\r') ? '\r' : '';
      // `[\s>]*` preserves any leading blockquote/callout markers on write-back.
      let next = line.replace(/^([\s>]*)- \[.\]/u, `$1- [${target}]`);
      next = TaskMutationService.stripStamp(next, '✅');
      next = TaskMutationService.stripStamp(next, '❌');
      let targetType: 'open' | 'done';
      if (registry) targetType = registry.typeForSymbol(target) === 'done' ? 'done' : 'open';
      else targetType = target === 'x' ? 'done' : 'open';
      if (!isDone && targetType === 'done') {
        next = TaskMutationService.addStamp(next, '✅', today, cr);
      } else {
        next = next.trimEnd() + cr;
      }
      lines[taskLine] = next;
    });
  }

  /** Rewrite the marker char inside `[ ]` and manage ✅/❌ stamps for the target type. */
  async setStatusChar(locator: TaskLocator, char: string, today: string): Promise<MutationResult> {
    return this.applyToLines(locator, (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const cur = /^[\s>]*- \[(.)\]/u.exec(line)?.[1];
      if (cur === char) return; // no-op: status unchanged, preserve existing ✅/❌ stamp
      const registry = this.getRegistry?.();
      const targetType = registry ? registry.typeForSymbol(char) : 'open';
      const cr = line.endsWith('\r') ? '\r' : '';
      let next = line.replace(/^([\s>]*)- \[.\]/u, `$1- [${char}]`);
      next = TaskMutationService.stripStamp(next, '✅');
      next = TaskMutationService.stripStamp(next, '❌');
      if (targetType === 'done') {
        next = TaskMutationService.addStamp(next, '✅', today, cr);
      } else if (targetType === 'cancelled') {
        next = TaskMutationService.addStamp(next, '❌', today, cr);
      } else {
        next = next.trimEnd() + cr;
      }
      lines[taskLine] = next;
    });
  }

  /** Rewrite the priority emoji on the task line (replaces any existing one). */
  async setPriority(locator: TaskLocator, priority: TaskPriority): Promise<MutationResult> {
    const PRIORITY_EMOJIS = PRIORITY_LEVELS.map((l) => l.emoji).filter(Boolean);
    const PRIORITY_MAP: Record<string, string> = Object.fromEntries(
      PRIORITY_LEVELS.filter((l) => l.emoji).map((l) => [l.value, l.emoji]),
    );
    return this.applyToLines(locator, (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      let updated = line;
      for (const emoji of PRIORITY_EMOJIS) updated = updated.replace(emoji, '');
      if (priority !== 'D' && PRIORITY_MAP[priority])
        updated = updated.trimEnd() + ` ${PRIORITY_MAP[priority]}`;
      lines[taskLine] = updated.replace(/\s{2,}/gu, ' ').trimEnd();
    });
  }

  /** Insert a new line immediately after the task (or after its subtask range).
   *  When `insertAfterLine` is provided it is treated as a hint from the last index;
   *  it is adjusted by the same drift that moved the task itself. */
  async insertLineAfter(
    locator: TaskLocator,
    newLine: string,
    insertAfterLine?: number,
  ): Promise<MutationResult> {
    return this.applyToLines(locator, (lines, taskLine) => {
      const delta = taskLine - locator.line;
      const insertAt = insertAfterLine !== undefined ? insertAfterLine + delta + 1 : taskLine + 1;
      lines.splice(insertAt, 0, newLine);
    });
  }

  /** Remove a single line. `lineToRemove` is a hint from the last index;
   *  it is adjusted by the same drift that moved the anchor task. */
  async removeLine(locator: TaskLocator, lineToRemove: number): Promise<MutationResult> {
    return this.applyToLines(locator, (lines, taskLine) => {
      const delta = taskLine - locator.line;
      const idx = lineToRemove + delta;
      if (idx >= 0 && idx < lines.length) lines.splice(idx, 1);
    });
  }

  /** Delete the task and its sub-item block.
   *  Block end is determined by indentation scan on the live content (not the stale hint),
   *  so the operation is safe even when lines were inserted or deleted inside the block. */
  async deleteTaskBlock(locator: TaskLocator, _rangeEndHint: number): Promise<MutationResult> {
    return this.applyToLines(locator, (lines, taskLine) => {
      const [start, end] = taskBlockRange(lines, taskLine);
      lines.splice(start, end - start + 1);
    });
  }

  /**
   * Move a task and its sub-item block from its source file into `targetPath`,
   * honoring the given insertion policy. "Project membership" in this plugin is
   * physical file location, so this is how a task is reassigned to a project.
   *
   * Ordering is data-loss safe: the block is captured from a read-only snapshot,
   * appended to the target, and only then removed from the source (re-located by
   * rawText for drift safety). If the target write succeeds but the source can no
   * longer be located, the task exists in both files (recoverable) rather than
   * being lost. A move into the file it already lives in is a no-op.
   */
  async moveTaskToFile(
    locator: TaskLocator,
    targetPath: string,
    insertion: { mode: 'append' | 'section'; section: string },
  ): Promise<MutationResult> {
    if (locator.filePath === targetPath) return { type: 'ok' };

    const sourceFile = this.app.vault.getAbstractFileByPath(locator.filePath);
    if (!(sourceFile instanceof TFile)) {
      new Notice('Task file not found: ' + locator.filePath);
      return { type: 'file-not-found' };
    }
    const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(targetFile instanceof TFile)) {
      new Notice('Target note not found: ' + targetPath);
      return { type: 'file-not-found' };
    }

    // Phase 1 — capture the block from a read-only snapshot (no write yet).
    const sourceData = await this.app.vault.read(sourceFile);
    const sourceLines = sourceData.split('\n');
    const found = findTaskLine(sourceLines, locator);
    if (found.type === 'not-found') {
      new Notice('Could not move task: it may have been moved or deleted.');
      return { type: 'not-found' };
    }
    if (found.type === 'ambiguous') {
      new Notice('Could not move task: multiple identical tasks found in the file.');
      return { type: 'ambiguous', candidates: found.candidates };
    }
    const [start, end] = taskBlockRange(sourceLines, found.line);
    // Normalise any CRLF so the block joins cleanly into the (possibly LF) target.
    const block = sourceLines
      .slice(start, end + 1)
      .map((l) => l.replace(/\r$/, ''))
      .join('\n');

    // Phase 2 — append to the target first, so a failure here loses nothing.
    await this.app.vault.process(targetFile, (content) =>
      insertTaskBlockIntoContent(content, block, insertion.mode, insertion.section),
    );

    // Phase 3 — remove from the source, re-locating by rawText for drift safety.
    let removedFromSource = false;
    await this.app.vault.process(sourceFile, (content) => {
      const lines = content.split('\n');
      const refound = findTaskLine(lines, locator);
      if (refound.type !== 'found') return content;
      const [s, e] = taskBlockRange(lines, refound.line);
      lines.splice(s, e - s + 1);
      removedFromSource = true;
      return lines.join('\n');
    });

    // The task was appended to the target but could no longer be located in the
    // source (an external edit slipped in between phases). It now exists in both
    // files — never lost, but the user should know a stray copy remains.
    if (!removedFromSource) {
      new Notice('Task moved into the project, but a copy remains in the original note.');
    }

    return { type: 'ok' };
  }
}
