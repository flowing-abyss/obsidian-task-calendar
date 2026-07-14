import type { TaskDestination } from '../domain/types';

export type TaskDestinationResolution =
  | { readonly type: 'resolved'; readonly destination: TaskDestination }
  | { readonly type: 'unavailable' };

/** Resolves and, when configured policy requires it, prepares the current default note. */
export interface TaskDestinationProvider {
  resolveConfiguredDefault(): Promise<TaskDestinationResolution>;
  prepare(destination: TaskDestination): Promise<TaskDestinationResolution>;
}
