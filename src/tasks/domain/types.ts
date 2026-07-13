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
