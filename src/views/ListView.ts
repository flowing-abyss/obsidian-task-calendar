import type { Task } from '../parser/types';
import { DEFAULT_VIEW_CONFIG } from '../settings/defaults';
import type { ResolvedConfig } from '../settings/types';
import { renderSourceNoteChip, shouldShowSourceNote } from '../ui/sourceNoteChip';
import { BaseView } from './BaseView';
import { getTasksForDate, sortTasks } from './taskGrouping';

export interface ListViewCallbacks {
  onToggle: (task: Task) => void;
  onDateClick: (date: string) => void;
  onTaskClick?: (task: Task) => void;
}

export class ListView extends BaseView {
  private config: ResolvedConfig = {
    ...DEFAULT_VIEW_CONFIG,
    isMobile: false,
    sourceNoteDisplay: 'non-default',
    customFilePath: '',
  };

  constructor(private callbacks: ListViewCallbacks) {
    super();
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.config = config;
    container.empty();

    const today = window.moment().format('YYYY-MM-DD');
    const yesterday = window.moment().subtract(1, 'day').format('YYYY-MM-DD');
    const month = config.startPosition
      ? window.moment(config.startPosition, 'YYYY-MM').date(1)
      : window.moment().date(1);

    const grid = container.createDiv({ cls: 'tc-list-view' });

    // Overdue section first
    const overdueTasks = tasks.filter((t) => t.status === 'open' && t.due && t.due < today);
    const overdueIds = new Set(overdueTasks.map((t) => `${t.filePath}:${t.line}`));
    if (overdueTasks.length > 0) {
      const section = grid.createDiv({ cls: 'tc-list-section' });
      const overdueHeader = section.createDiv({
        cls: 'tc-list-date-header tc-list-overdue-header',
      });
      overdueHeader.createEl('span', { cls: 'tc-list-date-label', text: 'Overdue' });
      overdueHeader.createEl('span', {
        cls: 'tc-list-date-count',
        text: String(overdueTasks.length),
      });
      for (const task of sortTasks(overdueTasks)) {
        this.renderListTask(section, task);
      }
    }

    for (let i = 1; i <= 31; i++) {
      const currentDate = window.moment(month).date(i).format('YYYY-MM-DD');
      if (window.moment(currentDate).month() !== window.moment(month).month()) break;

      const groups = getTasksForDate(tasks, currentDate, today);
      // Combine all task groups (due, recurrence, start, scheduled, process, dailyNote, allDone, cancelled)
      // Exclude overdue — it has its own section at the top
      const allTasks: Task[] = [];
      for (const [key, group] of Object.entries(groups)) {
        if (key === 'overdue') continue;
        if (Array.isArray(group)) allTasks.push(...(group as Task[]));
      }
      // Deduplicate: a task may appear in multiple groups (e.g. due + scheduled on same day)
      const seen = new Set<string>();
      const uniqueTasks = allTasks.filter((t) => {
        const id = `${t.filePath}:${t.line}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      // Filter to only open tasks; also exclude tasks already shown in the overdue section
      const openDayTasks = uniqueTasks.filter(
        (t) => t.status === 'open' && !overdueIds.has(`${t.filePath}:${t.line}`),
      );
      if (openDayTasks.length === 0) continue;

      const section = grid.createDiv({ cls: 'tc-list-section' });

      let dateLabel: string;
      if (currentDate === today) dateLabel = 'Today';
      else if (currentDate === yesterday) dateLabel = 'Yesterday';
      else dateLabel = window.moment(currentDate).format('ddd, D MMM');

      const dateHeader = section.createDiv({ cls: 'tc-list-date-header' });
      dateHeader.createEl('span', { cls: 'tc-list-date-label', text: dateLabel });
      dateHeader.createEl('span', {
        cls: 'tc-list-date-count',
        text: String(openDayTasks.length),
      });
      dateHeader.addEventListener('click', () => this.callbacks.onDateClick(currentDate));

      for (const task of sortTasks(openDayTasks)) {
        this.renderListTask(section, task);
      }
    }
  }

  private renderListTask(container: HTMLElement, task: Task): void {
    const row = container.createDiv({ cls: 'tc-list-task' });

    const cb = row.createEl('input', {
      cls: 'tc-task-checkbox',
      attr: { type: 'checkbox' },
    });
    cb.checked = task.status === 'done';
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      this.callbacks.onToggle(task);
    });

    let statusClass = '';
    if (task.status === 'done') {
      statusClass = ' is-done';
    } else if (task.status === 'cancelled') {
      statusClass = ' is-cancelled';
    }
    row.createEl('span', {
      cls: `tc-list-task-title${statusClass}`,
      text: task.text,
    });

    const meta = row.createDiv({ cls: 'tc-list-task-meta' });
    if (task.time) {
      meta.createEl('span', { cls: 'tc-task-time', text: task.time });
    }

    // Source note chip — before tags
    if (shouldShowSourceNote(task, this.config.sourceNoteDisplay, this.config.customFilePath)) {
      renderSourceNoteChip(meta, task);
    }

    const tags = task.rawText.match(/#[\w/-]+/gu) ?? [];
    for (const tag of tags.slice(0, 1)) {
      meta.createEl('span', { cls: 'tc-task-tag', text: tag });
    }
    if ((task.subtasks?.length ?? 0) > 0) {
      const done = task.subtasks!.filter((s) => s.status === 'done').length;
      meta.createEl('span', {
        cls: 'tc-task-progress',
        text: `${done}/${task.subtasks!.length}`,
      });
    }

    row.addEventListener('click', (e) => {
      if (e.target === cb) return;
      this.callbacks.onTaskClick?.(task);
    });
  }

  destroy(): void {}
}
