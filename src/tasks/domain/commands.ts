import type { LocalDate, SubtaskRef, TaskMutationTarget, TaskRef, TaskSnapshot } from './types';
import type { TaskIssue } from './validation';

export type FieldUpdate<T> =
  | { readonly type: 'set'; readonly value: T }
  | { readonly type: 'clear' };

/** The planning fields with current production consumers in Task 5A. */
export interface TaskPatch {
  readonly due?: FieldUpdate<LocalDate>;
  readonly scheduled?: FieldUpdate<LocalDate>;
  readonly start?: FieldUpdate<LocalDate>;
}

export type PlanningTarget =
  | { readonly type: 'task'; readonly ref: TaskRef }
  | { readonly type: 'subtask'; readonly ref: SubtaskRef };

export type TaskCommand =
  | { readonly type: 'patch'; readonly target: PlanningTarget; readonly patch: TaskPatch }
  | { readonly type: 'reschedule'; readonly ref: TaskRef; readonly date: LocalDate };

export type TaskCommandOutcome = { readonly type: 'task'; readonly task: TaskSnapshot };

export interface TaskResolutionCandidate {
  readonly root: TaskSnapshot;
  readonly target: TaskMutationTarget;
}

export type TaskCommandResult =
  | { readonly type: 'ok'; readonly outcome: TaskCommandOutcome; readonly changed: boolean }
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
