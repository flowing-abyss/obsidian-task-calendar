import type { Task } from '../parser/types';
import type { LocalDate } from '../tasks/domain/types';
import {
  calendarDatesForPlanning,
  TaskDateIndex as SnapshotDateIndex,
} from '../tasks/infrastructure/TaskDateIndex';

/** @deprecated Temporary compatibility surface; TaskStore uses the shared TaskIndex. */
export class TaskDateIndex {
  private readonly index = new SnapshotDateIndex<Task>((task) =>
    calendarDatesForPlanning({
      ...(task.start !== undefined && { start: task.start as LocalDate }),
      ...(task.scheduled !== undefined && { scheduled: task.scheduled as LocalDate }),
      ...(task.due !== undefined && { due: task.due as LocalDate }),
    }),
  );

  updateFile(filePath: string, tasks: Task[]): void {
    this.index.updateFile(filePath, tasks);
  }

  removeFile(filePath: string): void {
    this.index.removeFile(filePath);
  }

  getTasksForDate(date: string): Task[] {
    return [...this.index.get(date as LocalDate)];
  }

  clear(): void {
    this.index.clear();
  }
}
