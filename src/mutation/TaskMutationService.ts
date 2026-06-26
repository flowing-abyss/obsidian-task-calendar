import { Notice, TFile, type App } from 'obsidian';
import { findTaskLine, type FindResult, type TaskLocator } from './TaskLocator';

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
  constructor(private app: App) {}

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

  /** Toggle task completion: open → done (with ✅ today), done → open (strip ✅). */
  async toggleCompletion(locator: TaskLocator, today: string): Promise<MutationResult> {
    return this.applyToLines(locator, (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const isNowOpen = /^(\s*)- \[ \]/.test(line);
      if (isNowOpen) {
        lines[taskLine] = (
          line
            .replace(/^(\s*)- \[ \]/, '$1- [x]')
            // eslint-disable-next-line sonarjs/super-linear-regex
            .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '')
            .trimEnd() + ` ✅ ${today}`
        );
      } else {
        lines[taskLine] = line
          .replace(/^(\s*)- \[.\]/, '$1- [ ]')
          // eslint-disable-next-line sonarjs/super-linear-regex
          .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '')
          .trimEnd();
      }
    });
  }

  /** Insert a new line immediately after the task (or after its subtask range). */
  async insertLineAfter(
    locator: TaskLocator,
    newLine: string,
    insertAfterLine?: number,
  ): Promise<MutationResult> {
    return this.applyToLines(locator, (lines, taskLine) => {
      const insertAt = insertAfterLine !== undefined ? insertAfterLine + 1 : taskLine + 1;
      lines.splice(insertAt, 0, newLine);
    });
  }

  /** Remove a single line by its locator (used for comment deletion). */
  async removeLine(locator: TaskLocator, lineToRemove: number): Promise<MutationResult> {
    return this.applyToLines(locator, (lines) => {
      lines.splice(lineToRemove, 1);
    });
  }

  /** Delete the task and its sub-item block (from task line to subtaskRange.to inclusive). */
  async deleteTaskBlock(locator: TaskLocator, rangeEndHint: number): Promise<MutationResult> {
    return this.applyToLines(locator, (lines, taskLine) => {
      const to = rangeEndHint > taskLine ? rangeEndHint : taskLine;
      lines.splice(taskLine, to - taskLine + 1);
    });
  }
}
