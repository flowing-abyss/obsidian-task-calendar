import type { TaskCommand, TaskCommandOutcome, TaskResolutionCandidate } from '../domain/commands';
import type { TaskMutationTarget, TaskSnapshot } from '../domain/types';
import type { TaskIssue } from '../domain/validation';

export type TaskEditCommand = TaskCommand;

export type TaskRepositoryResult =
  | { readonly type: 'committed'; readonly outcome: TaskCommandOutcome; readonly changed: boolean }
  | { readonly type: 'conflict'; readonly current: TaskSnapshot }
  | { readonly type: 'not-found'; readonly target: TaskMutationTarget }
  | { readonly type: 'ambiguous'; readonly candidates: readonly TaskResolutionCandidate[] }
  | { readonly type: 'invalid'; readonly issues: readonly TaskIssue[] }
  | {
      readonly type: 'io-error';
      readonly cause: string;
      readonly path?: string;
      readonly contentState: 'unchanged' | 'unknown';
    };

export interface TaskRepository {
  edit(command: TaskEditCommand): Promise<TaskRepositoryResult>;
}
