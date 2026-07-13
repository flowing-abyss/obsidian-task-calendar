import type {
  DateRange,
  LocalDate,
  TaskMutationTarget,
  TaskRef,
  TaskSnapshot,
  TaskStatus,
} from '../domain/types';

export interface TaskQuery {
  readonly filePath?: string;
  readonly folder?: string;
  readonly tag?: string;
  readonly statuses?: readonly TaskStatus[];
  readonly dateRange?: DateRange;
}

export type TaskIndexEvent =
  | { readonly type: 'initialized' }
  | { readonly type: 'changed'; readonly files: readonly string[] }
  | { readonly type: 'renamed'; readonly oldPath: string; readonly newPath: string }
  | { readonly type: 'deleted'; readonly path: string };

export interface TaskResolutionCandidate {
  readonly root: TaskSnapshot;
  readonly target: TaskMutationTarget;
}

export type TaskResolution =
  | { readonly type: 'exact'; readonly task: TaskSnapshot }
  | { readonly type: 'conflict'; readonly current: TaskSnapshot }
  | { readonly type: 'not-found'; readonly ref: TaskRef }
  | { readonly type: 'ambiguous'; readonly candidates: readonly TaskResolutionCandidate[] };

export interface TaskQueryApi {
  list(query?: TaskQuery): readonly TaskSnapshot[];
  forCalendarDates(dates: readonly LocalDate[]): readonly TaskSnapshot[];
  resolve(ref: TaskRef): TaskResolution;
  subscribe(listener: (event: TaskIndexEvent) => void): () => void;
}
