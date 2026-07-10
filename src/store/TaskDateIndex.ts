import type { Task } from '../parser/types';

/**
 * Incremental date -> tasks index for the calendar body. `updateFile` is O(dates
 * touched by that file), not O(total tasks) — the previous approach (scanning
 * every task per grid cell on every render) was O(cells x tasks).
 */
export class TaskDateIndex {
  private byDate = new Map<string, Task[]>();
  private datesByFile = new Map<string, Set<string>>();

  private static datesForTask(task: Task): string[] {
    if (task.start && task.due) {
      const dates: string[] = [];
      let cur = window.moment(task.start);
      const end = window.moment(task.due);
      let guard = 0;
      while (cur.isSameOrBefore(end, 'day') && guard < 366) {
        dates.push(cur.format('YYYY-MM-DD'));
        cur = cur.clone().add(1, 'day');
        guard++;
      }
      return dates;
    }
    // Deadline-marker case: scheduled is the body's anchor, but due (when distinct)
    // must also be indexed so a date-scoped query can find the marker on due's day.
    if (task.scheduled && task.due && task.scheduled !== task.due) {
      return [task.scheduled, task.due];
    }
    const anchor = task.scheduled ?? task.due;
    return anchor ? [anchor] : [];
  }

  /** Replace all index entries for `filePath` with the given tasks (pass [] to clear). */
  updateFile(filePath: string, tasks: Task[]): void {
    const oldDates = this.datesByFile.get(filePath);
    if (oldDates) {
      for (const date of oldDates) {
        const bucket = this.byDate.get(date);
        if (!bucket) continue;
        const filtered = bucket.filter((t) => t.filePath !== filePath);
        if (filtered.length) this.byDate.set(date, filtered);
        else this.byDate.delete(date);
      }
    }
    const newDates = new Set<string>();
    for (const task of tasks) {
      for (const date of TaskDateIndex.datesForTask(task)) {
        newDates.add(date);
        const bucket = this.byDate.get(date);
        if (bucket) bucket.push(task);
        else this.byDate.set(date, [task]);
      }
    }
    if (newDates.size) this.datesByFile.set(filePath, newDates);
    else this.datesByFile.delete(filePath);
  }

  removeFile(filePath: string): void {
    this.updateFile(filePath, []);
  }

  getTasksForDate(date: string): Task[] {
    return this.byDate.get(date) ?? [];
  }

  clear(): void {
    this.byDate.clear();
    this.datesByFile.clear();
  }
}
