import type {
  TaskCommand,
  TaskCommandOutcome,
  TaskResolutionCandidate,
  TaskStatusTarget,
} from '../domain/commands';
import type { LocalDate, TaskMutationTarget, TaskSnapshot } from '../domain/types';
import type { TaskIssue } from '../domain/validation';

export type TaskEditCommand =
  | Exclude<
      TaskCommand,
      { readonly type: 'set-status' | 'toggle-completion' } | { readonly type: 'add-comment' }
    >
  | {
      readonly type: 'set-status';
      readonly target: TaskStatusTarget;
      readonly symbol: string;
      readonly stamp?: LocalDate;
    }
  | {
      readonly type: 'add-comment';
      readonly parent: TaskStatusTarget;
      readonly text: string;
      readonly stamp: LocalDate;
    };

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
