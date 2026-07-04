import { Modal, type App } from 'obsidian';
import type { Task } from '../parser/types';
import type { ResolvedConfig } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';
import { BaseView } from '../views/BaseView';
import { ListView } from '../views/ListView';
import { MonthView } from '../views/MonthView';
import { WeekView } from '../views/WeekView';
import { showStatusMenuAt } from './statusMenu';
import { openInFile } from './taskNavigation';
import { Toolbar, type ViewEntry } from './Toolbar';

const VIEWS: ViewEntry[] = [
  { id: 'list', icon: '', label: 'List' },
  { id: 'month', icon: '', label: 'Month' },
  { id: 'week', icon: '', label: 'Week' },
];

type ActiveView = 'month' | 'week' | 'list';

export class CalendarRenderer {
  private toolbar: Toolbar | null = null;
  private activeView: BaseView | null = null;
  private activeViewType: ActiveView;
  private viewContainer: HTMLElement | null = null;
  private selectedDate: ReturnType<typeof window.moment>;
  private filterActive = false;
  private overdueHighlightActive = false;
  private activeStatGroup: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private rootEl: HTMLElement,
    private store: TaskStore,
    private config: ResolvedConfig,
    private app: App,
  ) {
    this.activeViewType = config.defaultView;
    this.selectedDate = window.moment().date(1);
    if (config.startPosition) {
      this.selectedDate = window.moment(config.startPosition, 'YYYY-MM').date(1);
    }
    if (this.activeViewType === 'week') {
      this.selectedDate = window.moment().startOf('week');
    }
  }

  mount(): void {
    this.rootEl.setAttribute('view', this.activeViewType);
    if (this.config.style) this.rootEl.addClass(this.config.style);

    // Wrap everything in a span (matches existing CSS selectors)
    const span = this.rootEl.createEl('span');

    this.toolbar = new Toolbar(span, VIEWS, {
      onPrev: () => this.navigate(-1),
      onNext: () => this.navigate(1),
      onToday: () => this.goToday(),
      onViewSwitch: (id) => this.switchView(id as ActiveView),
      onFilterToggle: () => {
        this.filterActive = !this.filterActive;
        this.rootEl.classList.toggle('filter', this.filterActive);
        this.updateToolbar();
      },
      onOverdueHighlight: () => {
        this.overdueHighlightActive = !this.overdueHighlightActive;
        this.updateToolbar();
      },
      onStatFilter: (group) => {
        this.activeStatGroup = group;
        this.applyStatFilter(group);
      },
      onStyleChange: (style) => {
        if (this.config.style) this.rootEl.removeClass(this.config.style);
        this.config = { ...this.config, style };
        this.rootEl.addClass(style);
        this.updateToolbar();
      },
    });

    this.viewContainer = span.createDiv();
    this.renderView();

    this.unsubscribe = this.store.onUpdate(() => {
      this.activeView?.patch(this.viewContainer!, this.store.getTasks(), this.buildConfig());
      this.updateToolbar();
    });
  }

  private navigate(dir: -1 | 1): void {
    if (this.activeViewType === 'month' || this.activeViewType === 'list') {
      this.selectedDate = window.moment(this.selectedDate).add(dir, 'months');
    } else {
      this.selectedDate = window
        .moment(this.selectedDate)
        .add(dir * 7, 'days')
        .startOf('week');
    }
    this.renderView();
  }

  private goToday(): void {
    if (this.activeViewType === 'week') {
      this.selectedDate = window.moment().startOf('week');
    } else {
      this.selectedDate = window.moment().date(1);
    }
    this.renderView();
  }

  private switchView(type: ActiveView): void {
    if (this.activeViewType === type) return;
    this.activeViewType = type;
    this.rootEl.setAttribute('view', type);
    this.activeView?.destroy();
    this.activeView = null;
    this.renderView();
  }

  private buildCallbacks() {
    return {
      onToggle: (task: Task) => {
        void this.store.toggleTask(task);
      },
      onCellClick: (date: string) => this.openAddTaskModal(date),
      onWeekClick: (weekNr: string, year: string) => {
        this.selectedDate = window
          .moment()
          .isoWeekYear(parseInt(year, 10))
          .isoWeek(parseInt(weekNr, 10))
          .startOf('isoWeek');
        this.switchView('week');
      },
      onDateClick: (date: string) => this.openAddTaskModal(date),
      onContextMenu: (ev: MouseEvent, task: Task) => {
        showStatusMenuAt(ev, {
          task,
          registry: this.store.statusRegistry,
          onPickStatus: (c) => void this.store.setTaskStatus(task, c),
          onPickPriority: (p) => void this.store.setPriority(task, p),
        });
      },
    };
  }

  private buildConfig(): ResolvedConfig {
    return {
      ...this.config,
      startPosition: this.selectedDate.format(
        this.activeViewType === 'week' ? 'YYYY-ww' : 'YYYY-MM',
      ),
    };
  }

  private renderView(): void {
    if (!this.viewContainer) return;
    const tasks = this.store.getTasks();
    const config = this.buildConfig();
    const cb = this.buildCallbacks();

    // Instantiate new view when type changes (callbacks are baked into constructor)
    if (!this.activeView || !this.isSameViewType()) {
      this.activeView?.destroy();
      if (this.activeViewType === 'month') {
        this.activeView = new MonthView({
          app: this.app,
          onToggle: cb.onToggle,
          onCellClick: cb.onCellClick,
          onWeekClick: cb.onWeekClick,
          onTaskClick: () => {},
          onDrop: () => {},
          onOpenNote: (t) => void openInFile(this.app, t),
          statusRegistry: this.store.statusRegistry,
          onContextMenu: cb.onContextMenu,
        });
      } else if (this.activeViewType === 'week') {
        this.activeView = new WeekView({
          app: this.app,
          onToggle: cb.onToggle,
          onCellClick: cb.onCellClick,
          onTaskClick: () => {},
          onDrop: () => {},
          onOpenNote: (t) => void openInFile(this.app, t),
          statusRegistry: this.store.statusRegistry,
          onContextMenu: cb.onContextMenu,
        });
      } else {
        this.activeView = new ListView({
          app: this.app,
          onToggle: cb.onToggle,
          onDateClick: cb.onDateClick,
          statusRegistry: this.store.statusRegistry,
          onContextMenu: cb.onContextMenu,
        });
      }
    }

    this.activeView.render(this.viewContainer, tasks, config);
    this.updateToolbar();
  }

  private isSameViewType(): boolean {
    if (!this.activeView) return false;
    if (this.activeViewType === 'month') return this.activeView instanceof MonthView;
    if (this.activeViewType === 'week') return this.activeView instanceof WeekView;
    return this.activeView instanceof ListView;
  }

  private updateToolbar(): void {
    if (!this.toolbar) return;
    const tasks = this.store.getTasks();
    const today = window.moment().format('YYYY-MM-DD');
    this.toolbar.update({
      currentView: this.activeViewType,
      currentTitle: this.currentTitle(),
      currentStyle: this.config.style ?? 'style1',
      filterActive: this.filterActive,
      overdueHighlightActive: this.overdueHighlightActive,
      activeStatGroup: this.activeStatGroup,
      stats: {
        done: tasks.filter((t) => t.status === 'done').length,
        due: tasks.filter((t) => t.due && t.status === 'open').length,
        overdue: tasks.filter(
          (t) => t.due && t.status === 'open' && window.moment(t.due).isBefore(today, 'day'),
        ).length,
        start: tasks.filter((t) => t.start && t.status === 'open').length,
        scheduled: tasks.filter((t) => t.scheduled && t.status === 'open').length,
        recurrence: tasks.filter((t) => t.recurrence && t.status === 'open').length,
        dailyNote: tasks.filter((t) => t.dailyNoteDate && t.status === 'open').length,
      },
    });
  }

  private currentTitle(): string {
    if (this.activeViewType === 'week') {
      return `Week ${this.selectedDate.format('w')} · ${this.selectedDate.format('YYYY')}`;
    }
    return `${this.selectedDate.format('MMMM')} ${this.selectedDate.format('YYYY')}`;
  }

  private applyStatFilter(group: string | null): void {
    // Remove all focus classes
    Array.from(this.rootEl.classList)
      .filter((c) => c.startsWith('focus'))
      .forEach((c) => this.rootEl.classList.remove(c));
    if (group) {
      this.rootEl.classList.add('focus' + group.charAt(0).toUpperCase() + group.slice(1));
    }
  }

  private openAddTaskModal(date: string): void {
    new TaskInputModal(this.app, async (text) => {
      if (text.trim()) await this.store.addTask(date, text.trim());
    }).open();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.activeView?.destroy();
    this.toolbar?.destroy();
    this.rootEl.empty();
  }
}

class TaskInputModal extends Modal {
  constructor(
    app: App,
    private onSubmit: (text: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    contentEl.style.cssText = 'display:block;padding:16px 20px 12px';
    const form = contentEl.createDiv({
      attr: {
        style:
          'display:flex;flex-direction:row;align-items:center;gap:10px;max-width:420px;margin:0 auto',
      },
    });
    const input = form.createEl('input', { type: 'text', placeholder: 'Task description' });
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    input.style.cssText =
      'flex:1;padding:8px 12px;font-size:1.05em;border:1px solid var(--interactive-accent);border-radius:6px;background:var(--background-secondary);color:var(--text-normal);outline:none';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.close();
        void this.onSubmit(input.value);
      }
    });
    input.focus();
    const btn = form.createEl('button', { text: 'Add' });
    // eslint-disable-next-line obsidianmd/no-static-styles-assignment
    btn.style.cssText =
      'flex:0 0 auto;padding:8px 16px;font-size:1.05em;border:none;border-radius:6px;background:var(--interactive-accent);color:var(--text-on-accent);cursor:pointer';
    btn.addEventListener('click', () => {
      this.close();
      void this.onSubmit(input.value);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
