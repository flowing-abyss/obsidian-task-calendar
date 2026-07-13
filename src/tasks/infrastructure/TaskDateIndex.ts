import type { LocalDate } from '../domain/types';

interface CalendarPlanning {
  readonly start?: LocalDate;
  readonly scheduled?: LocalDate;
  readonly due?: LocalDate;
}

function nextDate(date: LocalDate): LocalDate {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return value.toISOString().slice(0, 10) as LocalDate;
}

export function calendarDatesForPlanning(planning: CalendarPlanning): readonly LocalDate[] {
  if (planning.start && planning.due) {
    const dates: LocalDate[] = [];
    let current = planning.start;
    let guard = 0;
    while (current <= planning.due && guard < 366) {
      dates.push(current);
      current = nextDate(current);
      guard++;
    }
    return dates;
  }
  if (planning.scheduled && planning.due && planning.scheduled !== planning.due) {
    return [planning.scheduled, planning.due];
  }
  const anchor = planning.scheduled ?? planning.due;
  return anchor ? [anchor] : [];
}

export class TaskDateIndex<T> {
  private readonly byDate = new Map<LocalDate, T[]>();
  private readonly datesByFile = new Map<string, Set<LocalDate>>();
  private readonly tasksByFile = new Map<string, Set<T>>();

  constructor(private readonly datesForTask: (task: T) => readonly LocalDate[]) {}

  updateFile(filePath: string, tasks: readonly T[]): void {
    const previousTasks = this.tasksByFile.get(filePath);
    const previousDates = this.datesByFile.get(filePath);
    if (previousTasks && previousDates) {
      for (const date of previousDates) {
        const remaining = (this.byDate.get(date) ?? []).filter((task) => !previousTasks.has(task));
        if (remaining.length > 0) this.byDate.set(date, remaining);
        else this.byDate.delete(date);
      }
    }

    const dates = new Set<LocalDate>();
    for (const task of tasks) {
      for (const date of this.datesForTask(task)) {
        dates.add(date);
        const bucket = this.byDate.get(date);
        if (bucket) bucket.push(task);
        else this.byDate.set(date, [task]);
      }
    }
    if (tasks.length > 0) this.tasksByFile.set(filePath, new Set(tasks));
    else this.tasksByFile.delete(filePath);
    if (dates.size > 0) this.datesByFile.set(filePath, dates);
    else this.datesByFile.delete(filePath);
  }

  removeFile(filePath: string): void {
    this.updateFile(filePath, []);
  }

  get(date: LocalDate): readonly T[] {
    return [...(this.byDate.get(date) ?? [])];
  }

  clear(): void {
    this.byDate.clear();
    this.datesByFile.clear();
    this.tasksByFile.clear();
  }
}
