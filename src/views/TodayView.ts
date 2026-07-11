import { Component, type App } from 'obsidian';
import type { Task, TaskPriority } from '../parser/types';
import type { ResolvedConfig, TagGroup } from '../settings/types';
import type { StatusRegistry } from '../status/StatusRegistry';
import { BaseView } from './BaseView';
import { renderHourGrid, repositionNowLine } from './timegrid/HourGrid';
import { minutesToPixels } from './timegrid/layout';
import { renderAllDayCell, type AllDayCallbacks } from './timegrid/renderAllDay';
import {
  renderTimedBlocksForDay,
  renderTimedSpanContinuation,
  type TimedBlockCallbacks,
} from './timegrid/renderTimedBlocks';

export interface TimeGridCallbacks {
  app: App;
  onTaskClick: (task: Task) => void;
  onDrop: (dragData: string, targetDate: string) => void;
  onDropTime: (dragData: string, date: string, time: string) => void;
  onCreateAtTime: (date: string, time: string) => void;
  /** Click-to-create in the all-day/"no-time" row above the hour grid. Optional, mirroring the
   * hour grid's onCreateAtTime — threaded through to AllDayCallbacks by both TodayView and
   * WeekTimeGridView. */
  onCreateAtDate?: (date: string) => void;
  /** Header-cell click (Week's day headers): drills into the Day view for that date, same as
   * Month's onDayClick. Optional since TodayView itself has no need to re-drill into itself. */
  onDayHeaderClick?: (date: string) => void;
  onTimeChange: (task: Task, newStartMinutes: number) => void;
  onDurationChange: (task: Task, newDurationMinutes: number) => void;
  onStartChange: (task: Task, newStart: string) => void;
  onDueChange: (task: Task, newDue: string) => void;
  onExtendToSpan: (task: Task, newDue: string) => void;
  onToggle: (task: Task) => void;
  onSetStatus: (task: Task, status: string) => void;
  onSetPriority: (task: Task, priority: TaskPriority) => void;
  statusRegistry: StatusRegistry;
  tagGroups?: TagGroup[];
}

/**
 * Bucket tasks for a single date per the due-centric anchor rule (spec: due-centric contract).
 *
 * `timedSpans` (Task 29): a multi-day span (`start` && `due`) that additionally has a `time`
 * set is kept separate from the untimed `spans` bucket — it needs hour-grid treatment (a block
 * at its time-of-day row on every spanned day, per bucketing below) rather than the all-day
 * band's chip treatment `spans` gets. Consumers render it on its `due` day (the due-centric
 * anchor, matching `spans`' existing left/right-edge convention) as the full interactive block,
 * and on every other spanned day as a lighter continuation segment — see renderTimedBlocks.ts's
 * `renderTimedSpanContinuation` and MonthGridView's `timedSpans` handling.
 */
export function bucketTasksForDate(
  tasks: Task[],
  date: string,
): { timed: Task[]; spans: Task[]; timedSpans: Task[]; plain: Task[]; deadlines: Task[] } {
  const timed: Task[] = [];
  const spans: Task[] = [];
  const timedSpans: Task[] = [];
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
        if (t.time) {
          timedSpans.push(t);
        } else {
          spans.push(t);
        }
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

  return { timed, spans, timedSpans, plain, deadlines };
}

/** How often the now-line is repositioned while a Today/Week view showing today stays mounted. */
export const NOW_LINE_REFRESH_MS = 5 * 60 * 1000;

export class TodayView extends BaseView {
  private containerEl: HTMLElement | null = null;
  private md = new Component();
  private nowLineIntervalId: number | null = null;

  constructor(private callbacks: TimeGridCallbacks) {
    super();
  }

  render(
    container: HTMLElement,
    tasks: Task[],
    config: ResolvedConfig,
    shouldScrollToNow = true,
    preservedScrollTop?: number,
  ): void {
    this.md.unload();
    this.md = new Component();
    this.md.load();

    // A re-render on the same instance (e.g. config change) must not stack a second interval
    // on top of one already registered from a prior render() without an intervening destroy().
    if (this.nowLineIntervalId !== null) {
      window.clearInterval(this.nowLineIntervalId);
      this.nowLineIntervalId = null;
    }

    this.containerEl = container;
    const date = config.startPosition || window.moment().format('YYYY-MM-DD');

    const handles = renderHourGrid(
      container,
      [date],
      this.callbacks.onDropTime,
      this.callbacks.onCreateAtTime,
      this.callbacks.onDayHeaderClick,
    );
    const day = handles.days[0]!;

    const { timed, spans, timedSpans, plain, deadlines } = bucketTasksForDate(tasks, date);
    // Task 29: a timed multi-day span renders its full interactive block only on its `due`
    // day (the due-centric anchor, matching `spans`' existing left/right-edge convention) —
    // every other day it covers gets the lighter, non-interactive continuation segment instead,
    // so the same task never shows two full interactive blocks at once.
    const anchoredTimedSpans = timedSpans.filter((t) => t.due === date);
    const continuationTimedSpans = timedSpans.filter((t) => t.due !== date);

    const timedCallbacks: TimedBlockCallbacks = {
      app: this.callbacks.app,
      component: this.md,
      onTaskClick: this.callbacks.onTaskClick,
      onTimeChange: this.callbacks.onTimeChange,
      onDurationChange: this.callbacks.onDurationChange,
      onExtendToSpan: this.callbacks.onExtendToSpan,
      onStartChange: this.callbacks.onStartChange,
      onToggle: this.callbacks.onToggle,
      onSetStatus: this.callbacks.onSetStatus,
      onSetPriority: this.callbacks.onSetPriority,
      statusRegistry: this.callbacks.statusRegistry,
    };
    const tagGroups = this.callbacks.tagGroups ?? [];
    renderTimedBlocksForDay(
      day.hourColumnEl,
      [...timed, ...anchoredTimedSpans],
      timedCallbacks,
      tagGroups,
    );
    renderTimedSpanContinuation(
      day.hourColumnEl,
      continuationTimedSpans,
      this.callbacks.onTaskClick,
      tagGroups,
    );

    const allDayCallbacks: AllDayCallbacks = {
      app: this.callbacks.app,
      component: this.md,
      onTaskClick: this.callbacks.onTaskClick,
      onDrop: this.callbacks.onDrop,
      onStartChange: this.callbacks.onStartChange,
      onDueChange: this.callbacks.onDueChange,
      onExtendToSpan: this.callbacks.onExtendToSpan,
      onToggle: this.callbacks.onToggle,
      onSetStatus: this.callbacks.onSetStatus,
      onSetPriority: this.callbacks.onSetPriority,
      statusRegistry: this.callbacks.statusRegistry,
      onCreateAtDate: this.callbacks.onCreateAtDate,
    };
    renderAllDayCell(day.allDayCellEl, date, spans, plain, deadlines, allDayCallbacks, tagGroups);

    const isToday = date === window.moment().format('YYYY-MM-DD');
    const gridRowEl = handles.gridRowEl;
    // One-time scroll-into-position: only when CenterPanel says this is a genuinely new
    // (viewType, date) it hasn't scrolled for yet — NOT on every reactive re-render of the
    // same view/date (Task 27). The periodic now-line repositioning below is unconditional
    // and untouched — a separate, still-desired behavior (Round 2 Task 16).
    if (shouldScrollToNow) {
      if (isToday) {
        const nowMinutes = window.moment().hours() * 60 + window.moment().minutes();
        const nowPx = minutesToPixels(nowMinutes);
        window.setTimeout(() => {
          gridRowEl.scrollTop = Math.max(0, nowPx - gridRowEl.clientHeight / 2);
        }, 0);
      }
    } else if (preservedScrollTop !== undefined) {
      // Task 31: this is a reactive re-render (destroy/recreate) of the same view/date — restore
      // the outgoing grid-row's scroll position instead of leaving the fresh one at 0. Deferred
      // via setTimeout like the scroll-to-now branch above: setting scrollTop synchronously,
      // before the browser has laid out the freshly-created grid, gets silently clamped to 0.
      window.setTimeout(() => {
        gridRowEl.scrollTop = preservedScrollTop;
      }, 0);
    }

    if (isToday) {
      const nowLineEl = handles.nowLineEl;
      if (nowLineEl) {
        this.nowLineIntervalId = window.setInterval(() => {
          repositionNowLine(nowLineEl);
        }, NOW_LINE_REFRESH_MS);
      }
    }
  }

  destroy(): void {
    this.containerEl = null;
    this.md.unload();
    if (this.nowLineIntervalId !== null) {
      window.clearInterval(this.nowLineIntervalId);
      this.nowLineIntervalId = null;
    }
  }
}
