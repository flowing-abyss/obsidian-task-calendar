import { Notice } from 'obsidian';
import type { TaskCommandResult } from '../tasks';

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
  }
  new Notice(message);
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
