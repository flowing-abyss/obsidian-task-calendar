import { Notice, type App } from 'obsidian';
import type { TaskApplicationApi, TaskCommandResult } from '../tasks';
import { TaskMoveRecoveryModal } from './TaskMoveRecoveryModal';

export function presentTaskCommandResult(result: TaskCommandResult): void {
  if (result.type === 'ok') return;
  let message: string;
  switch (result.type) {
    case 'conflict':
      message = 'This task changed before the update could be applied.';
      break;
    case 'ambiguous':
      message = 'Multiple matching tasks were found. Reopen the task and try again.';
      break;
    case 'not-found':
      message = 'This task no longer exists.';
      break;
    case 'invalid':
      message = 'The task update is invalid and was not saved.';
      break;
    case 'io-error':
      message = 'Failed to update task. Please try again.';
      break;
    case 'partial':
      message = 'The task was copied, but the original could not be removed.';
      break;
  }
  new Notice(message);
}

export function presentTaskMoveResult(
  app: App,
  tasks: TaskApplicationApi,
  result: TaskCommandResult,
): void {
  if (result.type === 'partial') {
    new TaskMoveRecoveryModal(app, tasks, result.recovery).open();
    return;
  }
  if (result.type === 'io-error' && result.contentState === 'unknown') {
    const target = result.path ?? 'the target file';
    new Notice(
      `Could not confirm whether the move to ${target} was saved. Rescan and inspect the target and original task before taking any action. Do not retry the move.`,
    );
    return;
  }
  presentTaskCommandResult(result);
}

export function presentTaskCreationResult(
  result: TaskCommandResult,
  options: { readonly announceSuccess: boolean } = { announceSuccess: true },
): void {
  if (result.type === 'ok') {
    if (!options.announceSuccess || result.outcome.type !== 'task') return;
    const path = result.outcome.task.source.filePath;
    new Notice(`Task added to ${path.split('/').pop() ?? path}`);
    return;
  }
  if (result.type === 'invalid') {
    const unavailable = result.issues.some((issue) => issue.code === 'destination-unavailable');
    new Notice(
      unavailable
        ? 'No target file found for task.'
        : 'The new task is invalid and was not created.',
    );
    return;
  }
  if (result.type === 'io-error') {
    new Notice('Failed to create task. Please try again.');
    return;
  }
  presentTaskCommandResult(result);
}
