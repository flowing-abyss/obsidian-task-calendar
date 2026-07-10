import { Component } from 'obsidian';
import type { Task } from '../parser/types';
import type { ResolvedConfig } from '../settings/types';
import { BaseView } from './BaseView';
import { bucketTasksForDate, NOW_LINE_REFRESH_MS, type TimeGridCallbacks } from './TodayView';
import { renderHourGrid, repositionNowLine } from './timegrid/HourGrid';
import { minutesToPixels } from './timegrid/layout';
import { renderAllDayCell, type AllDayCallbacks } from './timegrid/renderAllDay';
import { renderTimedBlocksForDay, type TimedBlockCallbacks } from './timegrid/renderTimedBlocks';

export class WeekTimeGridView extends BaseView {
  private containerEl: HTMLElement | null = null;
  private md = new Component();
  private nowLineIntervalId: number | null = null;

  constructor(private callbacks: TimeGridCallbacks) {
    super();
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.md.unload();
    this.md = new Component();
    this.md.load();

    // A re-render on the same instance (e.g. week change) must not stack a second interval on
    // top of one already registered from a prior render() without an intervening destroy().
    if (this.nowLineIntervalId !== null) {
      window.clearInterval(this.nowLineIntervalId);
      this.nowLineIntervalId = null;
    }

    this.containerEl = container;
    const week = config.startPosition
      ? window.moment(config.startPosition, 'YYYY-ww').startOf('week')
      : window.moment().startOf('week');
    const currentWeekday = parseInt(window.moment(week).format('d'), 10);

    const dates: string[] = [];
    for (
      let i = 0 - currentWeekday + config.firstDayOfWeek;
      i < 7 - currentWeekday + config.firstDayOfWeek;
      i++
    ) {
      dates.push(window.moment(week).add(i, 'days').format('YYYY-MM-DD'));
    }

    const handles = renderHourGrid(
      container,
      dates,
      this.callbacks.onDropTime,
      this.callbacks.onCreateAtTime,
      this.callbacks.onDayHeaderClick,
    );

    const timedCallbacks: TimedBlockCallbacks = {
      app: this.callbacks.app,
      component: this.md,
      onTaskClick: this.callbacks.onTaskClick,
      onTimeChange: this.callbacks.onTimeChange,
      onDurationChange: this.callbacks.onDurationChange,
      onToggle: this.callbacks.onToggle,
      onSetStatus: this.callbacks.onSetStatus,
      onSetPriority: this.callbacks.onSetPriority,
      statusRegistry: this.callbacks.statusRegistry,
    };
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

    const tagGroups = this.callbacks.tagGroups ?? [];
    for (const day of handles.days) {
      const { timed, spans, plain, deadlines } = bucketTasksForDate(tasks, day.date);
      renderTimedBlocksForDay(day.hourColumnEl, timed, timedCallbacks, tagGroups);
      renderAllDayCell(
        day.allDayCellEl,
        day.date,
        spans,
        plain,
        deadlines,
        allDayCallbacks,
        tagGroups,
      );
    }

    const today = window.moment().format('YYYY-MM-DD');
    if (dates.includes(today)) {
      const gridRowEl = handles.gridRowEl;
      const nowMinutes = window.moment().hours() * 60 + window.moment().minutes();
      const nowPx = minutesToPixels(nowMinutes);
      window.setTimeout(() => {
        gridRowEl.scrollTop = Math.max(0, nowPx - gridRowEl.clientHeight / 2);
      }, 0);

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
