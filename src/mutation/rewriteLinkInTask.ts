import { rewriteNthLink } from '../parser/links';
import type { SubTask, Task } from '../parser/types';
import { locatorOf } from './TaskLocator';
import type { TaskMutationService } from './TaskMutationService';

/** Replace the Nth link in a task/subtask's own line with `newRaw`. */
export async function rewriteLinkInTask(
  mutations: TaskMutationService,
  task: Task | SubTask,
  occurrenceIndex: number,
  newRaw: string,
): Promise<void> {
  await mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
    const line = lines[taskLine];
    if (!line) return;
    lines[taskLine] = rewriteNthLink(line, occurrenceIndex, newRaw);
  });
}
