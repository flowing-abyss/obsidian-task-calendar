export type TaskStatus = 'open' | 'done' | 'cancelled' | 'in-progress';
export type TaskStatusType = 'todo' | 'in-progress' | 'done' | 'cancelled';
export type TaskPriority = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

declare const localDateBrand: unique symbol;
declare const localTimeBrand: unique symbol;
declare const durationBrand: unique symbol;
export type LocalDate = string & { readonly [localDateBrand]: true };
export type LocalTime = string & { readonly [localTimeBrand]: true };
export type DurationMinutes = number & { readonly [durationBrand]: true };

export interface TaskStatusRule {
  readonly id: string;
  readonly symbol: string;
  readonly type: TaskStatusType;
  readonly defaultForType: boolean;
}

export interface DateRange {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

export interface TaskRef {
  readonly filePath: string;
  readonly line: number;
  readonly revision: string;
}

interface SubtaskRef {
  readonly parent: TaskNodeRef;
  readonly relativeLine: number;
  readonly originalBlock: string;
}

export interface CommentRef {
  readonly parent: TaskNodeRef;
  readonly relativeLine: number;
  readonly originalMarkdown: string;
}

export type TaskNodeRef =
  | { readonly type: 'task'; readonly ref: TaskRef }
  | { readonly type: 'subtask'; readonly ref: SubtaskRef };

export type TaskMutationTarget =
  | TaskNodeRef
  | { readonly type: 'comment'; readonly ref: CommentRef };

export interface TaskPlanning {
  readonly due?: LocalDate;
  readonly scheduled?: LocalDate;
  readonly start?: LocalDate;
  readonly completion?: LocalDate;
  readonly cancelled?: LocalDate;
  readonly time?: LocalTime;
  readonly duration?: DurationMinutes;
}

export interface SubtaskPlanning {
  readonly due?: LocalDate;
  readonly scheduled?: LocalDate;
  readonly start?: LocalDate;
  readonly time?: LocalTime;
}

interface TaskSource {
  readonly filePath: string;
  readonly line: number;
  readonly originalMarkdown: string;
}

interface TaskPresentationMetadata {
  readonly linkCount: number;
  readonly dailyNoteDate?: LocalDate;
  readonly noteColor?: string;
  readonly noteTextColor?: string;
  readonly noteIcon?: string;
}

export interface TaskCommentSnapshot {
  readonly ref: CommentRef;
  readonly date?: LocalDate;
  readonly text: string;
}

export interface SubtaskSnapshot {
  readonly ref: SubtaskRef;
  readonly title: string;
  readonly markdownTitle: string;
  readonly status: TaskStatus;
  readonly statusSymbol: string;
  readonly priority: TaskPriority;
  readonly planning: SubtaskPlanning;
  readonly tags: readonly string[];
  readonly recurrence?: string;
  readonly subtasks: readonly SubtaskSnapshot[];
  readonly comments: readonly TaskCommentSnapshot[];
  readonly description?: string;
}

export interface TaskSnapshot {
  readonly ref: TaskRef;
  readonly title: string;
  readonly markdownTitle: string;
  readonly status: TaskStatus;
  readonly statusSymbol: string;
  readonly priority: TaskPriority;
  readonly planning: TaskPlanning;
  readonly tags: readonly string[];
  readonly recurrence?: string;
  readonly subtasks: readonly SubtaskSnapshot[];
  readonly comments: readonly TaskCommentSnapshot[];
  readonly description?: string;
  readonly source: TaskSource;
  readonly presentation: TaskPresentationMetadata;
}
