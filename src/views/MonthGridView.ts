import { Component, type App } from 'obsidian';
import type { Task } from '../parser/types';
import type { ResolvedConfig, TagGroup } from '../settings/types';
import type { StatusRegistry } from '../status/StatusRegistry';
import { tagColorFor } from '../tags/tagColor';
import { renderStatusMarker } from '../ui/StatusMarker';
import { renderTaskText } from '../ui/renderTaskText';
import { BaseView } from './BaseView';
import { bucketTasksForDate } from './TodayView';

export interface MonthGridViewCallbacks {
  app: App;
  onDayClick: (date: string) => void;
  onTaskClick: (task: Task) => void;
  onDrop: (dragData: string, targetDate: string) => void;
  onToggle: (task: Task) => void;
  statusRegistry: StatusRegistry;
  tagGroups?: TagGroup[];
}

export class MonthGridView extends BaseView {
  private containerEl: HTMLElement | null = null;
  private md = new Component();

  constructor(private callbacks: MonthGridViewCallbacks) {
    super();
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.md.unload();
    this.md = new Component();
    this.md.load();

    this.containerEl = container;
    container.empty();

    const today = window.moment().format('YYYY-MM-DD');
    const month = config.startPosition
      ? window.moment(config.startPosition, 'YYYY-MM').date(1)
      : window.moment().date(1);
    const firstDayOfMonth = parseInt(window.moment(month).format('d'), 10);

    const grid = container.createDiv({ cls: 'tc-mg-grid' });
    const headRow = grid.createDiv({ cls: 'tc-mg-head-row' });
    for (
      let h = 0 - firstDayOfMonth + config.firstDayOfWeek;
      h < 7 - firstDayOfMonth + config.firstDayOfWeek;
      h++
    ) {
      headRow.createDiv({
        cls: 'tc-mg-head',
        text: window.moment(month).add(h, 'days').format('ddd'),
      });
    }

    let starts = 0 - firstDayOfMonth + config.firstDayOfWeek;
    for (let w = 0; w < 6; w++) {
      const row = grid.createDiv({ cls: 'tc-mg-row' });
      for (let i = starts; i < starts + 7; i++) {
        const currentDate = window.moment(month).add(i, 'days').format('YYYY-MM-DD');
        const inCurrentMonth =
          window.moment(month).format('MM') === window.moment(month).add(i, 'days').format('MM');
        const cell = row.createDiv({
          cls: `tc-mg-cell${currentDate === today ? ' is-today' : ''}${inCurrentMonth ? '' : ' is-outside-month'}`,
        });
        cell.setAttribute('data-mg-date', currentDate);

        // Daily-note link (preserved from the legacy MonthView per spec) — opens/creates the
        // note directly; distinct from clicking elsewhere in the cell, which drills to Week.
        const dailyNotePath = config.dailyNoteFolder
          ? `${config.dailyNoteFolder}/${currentDate}`
          : currentDate;
        const dayLink = cell.createEl('a', {
          cls: 'internal-link tc-mg-day-label',
          href: dailyNotePath,
          text: window.moment(month).add(i, 'days').format('D'),
        });
        dayLink.addEventListener('click', (e) => e.stopPropagation());

        this.renderCompactCell(cell, tasks, currentDate);

        if (inCurrentMonth) {
          cell.addEventListener('click', (e) => {
            if (
              (e.target as HTMLElement).closest(
                '.tc-mg-plain, .tc-mg-block-dot, .tc-mg-span-segment, .tc-mg-deadline-marker, .tc-mg-day-label',
              )
            )
              return;
            this.callbacks.onDayClick(currentDate);
          });
        }
        cell.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });
        cell.addEventListener('drop', (e) => {
          e.preventDefault();
          const dragData = e.dataTransfer?.getData('text/plain');
          if (dragData) this.callbacks.onDrop(dragData, currentDate);
        });
      }
      starts += 7;
    }
  }

  private renderCompactCell(cell: HTMLElement, tasks: Task[], date: string): void {
    const { timed, spans, plain, deadlines } = bucketTasksForDate(tasks, date);
    const tagGroups = this.callbacks.tagGroups ?? [];

    for (const t of timed) {
      const dot = cell.createDiv({ cls: 'tc-mg-block-dot' });
      this.applyPriorityAndTag(dot, t, tagGroups);
      this.renderMarker(dot, t);
      dot.createSpan({ text: `${t.time} ` });
      this.renderTitle(dot, t);
      dot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onTaskClick(t);
      });
    }
    for (const t of spans) {
      const bar = cell.createDiv({ cls: 'tc-mg-span-segment' });
      this.applyPriorityAndTag(bar, t, tagGroups);
      this.renderMarker(bar, t);
      this.renderTitle(bar, t);
      bar.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onTaskClick(t);
      });
    }
    for (const t of plain) {
      const row = cell.createDiv({ cls: 'tc-mg-plain' });
      this.applyPriorityAndTag(row, t, tagGroups);
      this.renderMarker(row, t);
      this.renderTitle(row, t);
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onTaskClick(t);
      });
    }
    for (const t of deadlines) {
      const marker = cell.createDiv({ cls: 'tc-mg-deadline-marker' });
      // Priority-colored border (color = priority convention); no tag fill — deadline
      // markers stay a compact pill, not a filled colored body (structural distinction).
      if (t.priority !== 'D') marker.setAttribute('data-priority', t.priority);
      this.renderMarker(marker, t);
      marker.createSpan({ text: '📅 ' });
      this.renderTitle(marker, t);
      marker.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onTaskClick(t);
      });
    }
  }

  /** Renders the task's markdown/wiki-link-aware title text as a trailing inline span. */
  private renderTitle(container: HTMLElement, t: Task): void {
    const titleEl = container.createSpan();
    renderTaskText(titleEl, t.markdownText, {
      app: this.callbacks.app,
      sourcePath: t.filePath,
      component: this.md,
    });
  }

  // Status marker first: lets a user mark a compact item done without opening the modal. Its
  // own click handler stops propagation; its contextmenu handler does NOT, so a right-click on
  // the marker still bubbles to the item's own contextmenu handler below (opens modal).
  private renderMarker(el: HTMLElement, t: Task): void {
    renderStatusMarker(el, {
      task: t,
      registry: this.callbacks.statusRegistry,
      onLeftClick: () => this.callbacks.onToggle(t),
      onContextMenu: () => {},
    });
  }

  /** Priority-colored left border (color = priority convention) + tag-colored fill. */
  private applyPriorityAndTag(el: HTMLElement, t: Task, tagGroups: TagGroup[]): void {
    if (t.priority !== 'D') el.setAttribute('data-priority', t.priority);
    const tagColor = tagColorFor(t.rawText, tagGroups);
    if (tagColor) el.setCssProps({ '--tc-tag-color': tagColor });
  }

  destroy(): void {
    this.containerEl = null;
    this.md.unload();
  }
}
