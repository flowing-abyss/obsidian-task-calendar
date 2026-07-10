import type { Task } from '../parser/types';
import type { ResolvedConfig } from '../settings/types';
import { BaseView } from './BaseView';
import { bucketTasksForDate, type TimeGridCallbacks } from './TodayView';
import { renderAllDayCell, type AllDayCallbacks } from './timegrid/renderAllDay';
import { renderHourGrid } from './timegrid/HourGrid';
import { renderTimedBlocksForDay, type TimedBlockCallbacks } from './timegrid/renderTimedBlocks';

export type { TimeGridCallbacks as WeekTimeGridViewCallbacks };

export class WeekTimeGridView extends BaseView {
  private containerEl: HTMLElement | null = null;

  constructor(private callbacks: TimeGridCallbacks) {
    super();
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
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

    const handles = renderHourGrid(container, dates);

    const timedCallbacks: TimedBlockCallbacks = {
      onTaskClick: this.callbacks.onTaskClick,
      onTimeChange: this.callbacks.onTimeChange,
      onDurationChange: this.callbacks.onDurationChange,
    };
    const allDayCallbacks: AllDayCallbacks = {
      onTaskClick: this.callbacks.onTaskClick,
      onDrop: this.callbacks.onDrop,
      onStartChange: this.callbacks.onStartChange,
      onDueChange: this.callbacks.onDueChange,
    };

    for (const day of handles.days) {
      const { timed, spans, plain, deadlines } = bucketTasksForDate(tasks, day.date);
      renderTimedBlocksForDay(day.hourColumnEl, timed, timedCallbacks);
      renderAllDayCell(day.allDayCellEl, day.date, spans, plain, deadlines, allDayCallbacks);
    }
  }

  destroy(): void {
    this.containerEl = null;
  }
}
