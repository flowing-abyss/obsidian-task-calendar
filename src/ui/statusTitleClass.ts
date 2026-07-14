import type { TaskSnapshot } from '../tasks';

/**
 * Task 38 (Round 4 follow-up): `is-done`/`is-cancelled` suffix mirroring ListView.ts's
 * renderListTask statusClass convention, so a completed/cancelled task's title reads the
 * same (struck-through) wherever it renders — timed blocks/continuation segments
 * (renderTimedBlocks.ts, the original Task 38 scope), all-day span/plain items and deadline
 * markers (renderAllDay.ts), and Month-grid compact items (MonthGridView.ts). Extracted to
 * this shared module (out of renderTimedBlocks.ts, its original home) once a second and
 * third caller needed the identical logic, rather than duplicating it per file.
 */
export function statusTitleClass(status: TaskSnapshot['status']): string {
  if (status === 'done') return ' is-done';
  if (status === 'cancelled') return ' is-cancelled';
  return '';
}
