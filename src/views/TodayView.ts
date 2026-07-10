import { Component, type App } from 'obsidian';
import type { Task } from '../parser/types';
import type { ResolvedConfig, TagGroup } from '../settings/types';
import type { StatusRegistry } from '../status/StatusRegistry';
import { BaseView } from './BaseView';
import { renderHourGrid } from './timegrid/HourGrid';
import { renderAllDayCell, type AllDayCallbacks } from './timegrid/renderAllDay';
import { renderTimedBlocksForDay, type TimedBlockCallbacks } from './timegrid/renderTimedBlocks';

export interface TimeGridCallbacks {
  app: App;
  onTaskClick: (task: Task) => void;
  onDrop: (dragData: string, targetDate: string) => void;
  onTimeChange: (task: Task, newStartMinutes: number) => void;
  onDurationChange: (task: Task, newDurationMinutes: number) => void;
  onStartChange: (task: Task, newStart: string) => void;
  onDueChange: (task: Task, newDue: string) => void;
  onToggle: (task: Task) => void;
  statusRegistry: StatusRegistry;
  tagGroups?: TagGroup[];
}

/** Bucket tasks for a single date per the due-centric anchor rule (spec: due-centric contract). */
export function bucketTasksForDate(
  tasks: Task[],
  date: string,
): { timed: Task[]; spans: Task[]; plain: Task[]; deadlines: Task[] } {
  const timed: Task[] = [];
  const spans: Task[] = [];
  const plain: Task[] = [];
  const deadlines: Task[] = [];
  // Identity convention for task de-duplication (matches drag-payload identity used elsewhere,
  // e.g. MonthView.ts's `${task.filePath}:::${task.line}`).
  const spanIdentities = new Set<string>();

  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'cancelled') continue;

    // Multi-day span: anchored on every day from start to due
    if (t.start && t.due) {
      const inRange = window.moment(date).isBetween(t.start, t.due, 'day', '[]');
      if (inRange) {
        spans.push(t);
        spanIdentities.add(`${t.filePath}:::${t.line}`);
      }
      continue;
    }

    const anchor = t.scheduled ?? t.due;
    if (anchor !== date) continue;

    if (t.time) {
      timed.push(t);
    } else {
      plain.push(t);
    }
  }

  // Deadline markers: tasks whose `due` falls on this date AND a distinct `scheduled` is also set
  // (so their body renders elsewhere, on the scheduled day, per the due-centric contract).
  // Spans take priority: a task already rendered as a span (its due edge communicates the
  // deadline structurally) never also gets a separate deadline marker for the same date.
  for (const t of tasks) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (spanIdentities.has(`${t.filePath}:::${t.line}`)) continue;
    if (t.due === date && t.scheduled && t.scheduled !== t.due) deadlines.push(t);
  }

  return { timed, spans, plain, deadlines };
}

export class TodayView extends BaseView {
  private containerEl: HTMLElement | null = null;
  private md = new Component();

  constructor(private callbacks: TimeGridCallbacks) {
    super();
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.md.unload();
    this.md = new Component();
    this.md.load();

    this.containerEl = container;
    const date = config.startPosition || window.moment().format('YYYY-MM-DD');

    const handles = renderHourGrid(container, [date]);
    const day = handles.days[0]!;

    const { timed, spans, plain, deadlines } = bucketTasksForDate(tasks, date);

    const timedCallbacks: TimedBlockCallbacks = {
      app: this.callbacks.app,
      component: this.md,
      onTaskClick: this.callbacks.onTaskClick,
      onTimeChange: this.callbacks.onTimeChange,
      onDurationChange: this.callbacks.onDurationChange,
      onToggle: this.callbacks.onToggle,
      statusRegistry: this.callbacks.statusRegistry,
    };
    const tagGroups = this.callbacks.tagGroups ?? [];
    renderTimedBlocksForDay(day.hourColumnEl, timed, timedCallbacks, tagGroups);

    const allDayCallbacks: AllDayCallbacks = {
      app: this.callbacks.app,
      component: this.md,
      onTaskClick: this.callbacks.onTaskClick,
      onDrop: this.callbacks.onDrop,
      onStartChange: this.callbacks.onStartChange,
      onDueChange: this.callbacks.onDueChange,
      onToggle: this.callbacks.onToggle,
      statusRegistry: this.callbacks.statusRegistry,
    };
    renderAllDayCell(day.allDayCellEl, date, spans, plain, deadlines, allDayCallbacks, tagGroups);
  }

  destroy(): void {
    this.containerEl = null;
    this.md.unload();
  }
}
