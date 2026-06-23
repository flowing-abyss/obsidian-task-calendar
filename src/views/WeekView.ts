import type { Task } from '../parser/types';
import type { ResolvedConfig } from '../settings/types';
import { createTaskCard } from '../ui/TaskCard';
import { BaseView } from './BaseView';
import { getTasksForDate, renderTaskGroup } from './taskGrouping';

export interface WeekViewCallbacks {
  onToggle: (task: Task) => void;
  onCellClick: (date: string) => void;
}

export class WeekView extends BaseView {
  private containerEl: HTMLElement | null = null;

  constructor(private callbacks: WeekViewCallbacks) {
    super();
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.containerEl = container;
    container.empty();

    const today = window.moment().format('YYYY-MM-DD');
    const week = config.startPosition
      ? window.moment(config.startPosition, 'YYYY-ww').startOf('week')
      : window.moment().startOf('week');

    const grid = container.createDiv('grid');
    const currentWeekday = parseInt(window.moment(week).format('d'));

    for (
      let i = 0 - currentWeekday + config.firstDayOfWeek;
      i < 7 - currentWeekday + config.firstDayOfWeek;
      i++
    ) {
      const currentDate = window.moment(week).add(i, 'days').format('YYYY-MM-DD');
      const weekDay = window.moment(week).add(i, 'days').format('d');
      const longDayName = window.moment(currentDate).format('ddd, D. MMM');
      const dailyNotePath = config.dailyNoteFolder
        ? `${config.dailyNoteFolder}/${currentDate}`
        : currentDate;

      const cell = grid.createDiv({
        cls: currentDate === today ? 'cell currentWeek today' : 'cell currentWeek',
      });
      cell.setAttribute('data-weekday', weekDay);

      const cellLink = cell.createEl('a', { cls: 'internal-link cellName', href: dailyNotePath });
      cellLink.textContent = longDayName;

      const cellContent = cell.createDiv('cellContent');
      const groups = getTasksForDate(tasks, currentDate, today);
      renderTaskGroup(cellContent, groups, currentDate, today, (task, cls) =>
        createTaskCard(task, cls, { onToggle: this.callbacks.onToggle }),
      );

      cell.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.task')) return;
        if ((e.target as HTMLElement).closest('.cellName')) return;
        this.callbacks.onCellClick(currentDate);
      });
    }
  }

  destroy(): void {
    this.containerEl = null;
  }
}
