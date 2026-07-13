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
