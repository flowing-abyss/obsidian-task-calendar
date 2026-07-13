import type { SubTask, Task, TaskComment } from '../../parser/types';
import type {
  SubtaskRef,
  SubtaskSnapshot,
  TaskCommentSnapshot,
  TaskRef,
  TaskSnapshot,
} from '../domain/types';
import { TaskLocator } from '../infrastructure/markdown/TaskLocator';

interface LegacyTaskCommentView extends TaskComment {
  readonly ref: TaskCommentSnapshot['ref'];
}

interface LegacySubtaskView extends SubTask {
  readonly ref: SubtaskRef;
  readonly subtasks?: LegacySubtaskView[];
  readonly comments?: LegacyTaskCommentView[];
}

export interface LegacyTaskView extends Task {
  readonly ref: TaskRef;
  readonly subtasks?: LegacySubtaskView[];
  readonly comments?: LegacyTaskCommentView[];
}

function commentView(comment: TaskCommentSnapshot, parentLine: number): LegacyTaskCommentView {
  return {
    ref: comment.ref,
    line: parentLine + comment.ref.relativeLine,
    date: comment.date,
    text: comment.text,
  };
}

function subtaskView(
  task: SubtaskSnapshot,
  parentLine: number,
  filePath: string,
): LegacySubtaskView {
  const line = parentLine + task.ref.relativeLine;
  const lineCount = task.ref.originalBlock.split('\n').length;
  const subtasks = task.subtasks.map((child) => subtaskView(child, line, filePath));
  const comments = task.comments.map((comment) => commentView(comment, line));
  return {
    ref: task.ref,
    filePath,
    line,
    rawText: task.ref.originalBlock.split('\n')[0] ?? '',
    tags: [...task.tags],
    text: task.title,
    markdownText: task.markdownTitle,
    status: task.status,
    statusSymbol: task.statusSymbol,
    due: task.planning.due,
    scheduled: task.planning.scheduled,
    start: task.planning.start,
    time: task.planning.time,
    priority: task.priority,
    recurrence: task.recurrence,
    ...(subtasks.length > 0 && { subtasks }),
    ...(comments.length > 0 && { comments }),
    ...(task.description && { description: task.description }),
    ...(lineCount > 1 && { subtaskRange: { from: line + 1, to: line + lineCount - 1 } }),
  };
}

function blockRange(task: TaskSnapshot): { from: number; to: number } | undefined {
  const block = new TaskLocator().exactSource(task.ref.revision);
  if (block === undefined) return undefined;
  const lineCount = block.split(/\r?\n/u).length;
  return lineCount > 1
    ? { from: task.source.line + 1, to: task.source.line + lineCount - 1 }
    : undefined;
}

export function legacyTaskView(task: TaskSnapshot): LegacyTaskView {
  const subtasks = task.subtasks.map((subtask) =>
    subtaskView(subtask, task.source.line, task.source.filePath),
  );
  const comments = task.comments.map((comment) => commentView(comment, task.source.line));
  const subtaskRange = blockRange(task);
  return {
    ref: task.ref,
    filePath: task.source.filePath,
    line: task.source.line,
    rawText: task.source.originalMarkdown,
    tags: [...task.tags],
    text: task.title,
    markdownText: task.markdownTitle,
    status: task.status,
    statusSymbol: task.statusSymbol,
    due: task.planning.due,
    scheduled: task.planning.scheduled,
    start: task.planning.start,
    completion: task.planning.completion,
    cancelledDate: task.planning.cancelled,
    time: task.planning.time,
    duration: task.planning.duration,
    recurrence: task.recurrence,
    priority: task.priority,
    ...(subtasks.length > 0 && { subtasks }),
    ...(comments.length > 0 && { comments }),
    ...(task.description && { description: task.description }),
    ...(subtaskRange && { subtaskRange }),
    linkCount: task.presentation.linkCount,
    dailyNoteDate: task.presentation.dailyNoteDate,
    noteColor: task.presentation.noteColor,
    noteTextColor: task.presentation.noteTextColor,
    noteIcon: task.presentation.noteIcon,
  };
}

export function legacyTaskViews(tasks: readonly TaskSnapshot[]): LegacyTaskView[] {
  return tasks.map(legacyTaskView);
}

export function taskRefOf(task: Task | SubTask): TaskRef | undefined {
  return 'ref' in task ? (task as LegacyTaskView).ref : undefined;
}

export function rebuildLegacyTaskStack(
  root: LegacyTaskView,
  staleStack: readonly (Task | SubTask)[],
): Array<Task | SubTask> {
  const stack: Array<Task | SubTask> = [root];
  for (let index = 1; index < staleStack.length; index++) {
    const parent = stack[index - 1];
    const stale = staleStack[index];
    if (!parent || !stale) break;
    const staleRef = 'ref' in stale ? (stale as LegacySubtaskView).ref : undefined;
    if (!staleRef || !('relativeLine' in staleRef)) break;
    const candidates = (parent.subtasks ?? []).filter(
      (candidate): candidate is LegacySubtaskView => 'ref' in candidate,
    );
    const child =
      candidates.find(
        (candidate) =>
          candidate.ref.relativeLine === staleRef.relativeLine &&
          candidate.ref.originalBlock === staleRef.originalBlock,
      ) ??
      (() => {
        const matches = candidates.filter(
          (candidate) => candidate.ref.originalBlock === staleRef.originalBlock,
        );
        return matches.length === 1 ? matches[0] : undefined;
      })();
    if (!child) break;
    stack.push(child);
  }
  return stack;
}
