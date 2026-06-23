import type { SubTask, TaskComment } from './types';

export interface SubItemResult {
  subtasks: SubTask[];
  comments: TaskComment[];
  description: string;
  subtaskRange: { from: number; to: number } | undefined;
}

const SUBTASK_RE = /^(\s*)- \[([ xX])\]\s+(.*)/;
const DESCRIPTION_RE = /^(\s*)- > (.*)/;
const COMMENT_DATE_RE = /^(\s*)- (\d{4}-\d{2}-\d{2}):\s*(.*)/;
const COMMENT_RE = /^(\s*)- (.+)/;
const INDENT_RE = /^(\s*)/;

function getIndent(line: string): number {
  return INDENT_RE.exec(line)?.[1]?.length ?? 0;
}

function parseSubtask(
  lines: string[],
  i: number,
  filePath: string,
  subtaskMatch: RegExpExecArray,
): { subtask: SubTask; nextIdx: number; rangeTo: number } {
  const statusChar = subtaskMatch[2] ?? ' ';
  const text = (subtaskMatch[3] ?? '').trim();
  const childResult = parseSubItems(lines, i, filePath);
  const subtask: SubTask = {
    filePath,
    line: i,
    text,
    status: statusChar === ' ' ? 'open' : 'done',
  };
  if (childResult.subtasks.length) subtask.subtasks = childResult.subtasks;
  if (childResult.comments.length) subtask.comments = childResult.comments;
  if (childResult.description) subtask.description = childResult.description;
  let rangeTo = i;
  let nextIdx = i + 1;
  if (childResult.subtaskRange) {
    subtask.subtaskRange = childResult.subtaskRange;
    rangeTo = childResult.subtaskRange.to;
    nextIdx = childResult.subtaskRange.to + 1;
  }
  return { subtask, nextIdx, rangeTo };
}

export function parseSubItems(
  lines: string[],
  taskLineIdx: number,
  filePath: string,
): SubItemResult {
  const taskLine = lines[taskLineIdx] ?? '';
  const taskIndent = getIndent(taskLine);

  const subtasks: SubTask[] = [];
  const comments: TaskComment[] = [];
  const descLines: string[] = [];
  let rangeFrom: number | undefined;
  let rangeTo: number | undefined;

  let i = taskLineIdx + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === '') { i++; continue; }

    const lineIndent = getIndent(line);
    if (lineIndent <= taskIndent) break;

    if (rangeFrom === undefined) rangeFrom = i;
    rangeTo = i;

    const subtaskMatch = SUBTASK_RE.exec(line);
    if (subtaskMatch) {
      const parsed = parseSubtask(lines, i, filePath, subtaskMatch);
      subtasks.push(parsed.subtask);
      rangeTo = parsed.rangeTo;
      i = parsed.nextIdx;
      continue;
    }

    const descMatch = DESCRIPTION_RE.exec(line);
    if (descMatch) {
      descLines.push((descMatch[2] ?? '').trim());
      i++;
      continue;
    }

    const commentDateMatch = COMMENT_DATE_RE.exec(line);
    if (commentDateMatch) {
      comments.push({ line: i, date: commentDateMatch[2], text: (commentDateMatch[3] ?? '').trim() });
      i++;
      continue;
    }

    const commentMatch = COMMENT_RE.exec(line);
    if (commentMatch) {
      comments.push({ line: i, date: undefined, text: (commentMatch[2] ?? '').trim() });
      i++;
      continue;
    }

    i++;
  }

  return {
    subtasks,
    comments,
    description: descLines.join('\n'),
    subtaskRange:
      rangeFrom !== undefined && rangeTo !== undefined
        ? { from: rangeFrom, to: rangeTo }
        : undefined,
  };
}
