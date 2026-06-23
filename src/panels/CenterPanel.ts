import { Notice, TFile, setIcon, type App } from 'obsidian';
import type { AppState } from '../app/AppState';
import type { Task } from '../parser/types';
import { DEFAULT_VIEW_CONFIG } from '../settings/defaults';
import type { CalendarSettings, ResolvedConfig } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';
import { ListView } from '../views/ListView';
import { MonthView } from '../views/MonthView';
import { WeekView } from '../views/WeekView';

type CalViewType = 'month' | 'week' | 'list';

export class CenterPanel {
  private el!: HTMLElement;
  private offs: Array<() => void> = [];
  private calViewType: CalViewType = 'month';
  private calDate = window.moment().date(1);
  private calViewInstance: MonthView | WeekView | ListView | null = null;
  private calUnsubscribe: (() => void) | null = null;

  constructor(
    private state: AppState,
    private store: TaskStore,
    private app: App,
    private settings: CalendarSettings,
  ) {}

  mount(container: HTMLElement): void {
    this.el = container;
    this.offs.push(
      this.state.on('selectedList', () => this.render()),
      this.state.on('mode', () => this.render()),
      this.state.on('centerFilter', () => this.render()),
      this.state.on('searchQuery', () => this.render()),
    );
    this.render();
  }

  refresh(): void {
    this.render();
  }

  destroy(): void {
    this.offs.forEach((f) => f());
    this.destroyCalendarView();
    this.el?.empty();
  }

  private destroyCalendarView(): void {
    this.calUnsubscribe?.();
    this.calUnsubscribe = null;
    this.calViewInstance?.destroy();
    this.calViewInstance = null;
  }

  private render(): void {
    const mode = this.state.get('mode');

    if (mode === 'calendar') {
      this.el.empty();
      this.el.addClass('tc-center--calendar');
      this.destroyCalendarView();
      this.renderCalendarMode();
      return;
    }

    this.el.removeClass('tc-center--calendar');
    this.destroyCalendarView();
    this.el.empty();

    if (mode === 'search') {
      this.renderSearch();
      return;
    }

    // Header: list name + local search
    const header = this.el.createDiv({ cls: 'tc-center-header' });
    header.createEl('h2', { cls: 'tc-center-title', text: this.getTitle() });
    const searchInput = header.createEl('input', {
      cls: 'tc-center-search',
      attr: { type: 'text', placeholder: 'Filter…' },
    });
    searchInput.value = this.state.get('centerFilter');
    searchInput.addEventListener('input', () => {
      this.state.set('centerFilter', searchInput.value);
    });

    const tasks = this.getFilteredTasks();
    const scroll = this.el.createDiv({ cls: 'tc-center-scroll' });

    if (tasks.length === 0) {
      scroll.createDiv({ cls: 'tc-center-empty', text: 'No tasks' });
    } else {
      const sel = this.state.get('selectedList');
      const needsGrouping = sel === 'today' || sel === 'upcoming';
      if (needsGrouping) {
        this.renderGrouped(scroll, tasks);
      } else {
        this.renderFlat(scroll, tasks);
      }
    }

    this.renderAddTaskBar();
  }

  private renderCalendarMode(): void {
    const nav = this.el.createDiv({ cls: 'tc-cal-nav' });

    const prevBtn = nav.createEl('button', { cls: 'tc-cal-nav-btn', attr: { 'aria-label': 'Previous' } });
    setIcon(prevBtn, 'chevron-left');

    const titleEl = nav.createEl('span', { cls: 'tc-cal-nav-title' });

    const nextBtn = nav.createEl('button', { cls: 'tc-cal-nav-btn', attr: { 'aria-label': 'Next' } });
    setIcon(nextBtn, 'chevron-right');

    const todayBtn = nav.createEl('button', { cls: 'tc-cal-nav-today', text: 'Today' });

    const viewSwitcher = nav.createDiv({ cls: 'tc-cal-view-switcher' });
    for (const v of ['month', 'week', 'list'] as CalViewType[]) {
      const btn = viewSwitcher.createEl('button', {
        cls: `tc-cal-view-btn${this.calViewType === v ? ' is-active' : ''}`,
        text: v.charAt(0).toUpperCase() + v.slice(1),
      });
      btn.addEventListener('click', () => {
        this.calViewType = v;
        if (v === 'week') this.calDate = window.moment().startOf('isoWeek');
        else this.calDate = window.moment().date(1);
        this.render();
      });
    }

    const calStyle = this.settings.desktop.style ?? 'style1';
    const viewContainer = this.el.createDiv({ cls: `tc-cal-body tasksCalendar ${calStyle}` });
    viewContainer.setAttribute('view', this.calViewType);

    const config: ResolvedConfig = {
      ...DEFAULT_VIEW_CONFIG,
      ...this.settings.desktop,
      isMobile: false,
      startPosition: this.calDate.format(this.calViewType === 'week' ? 'YYYY-ww' : 'YYYY-MM'),
    };

    const updateTitle = (): void => {
      if (this.calViewType === 'week') {
        titleEl.textContent = `Week ${this.calDate.format('w')} · ${this.calDate.format('YYYY')}`;
      } else {
        titleEl.textContent = this.calDate.format('MMMM YYYY');
      }
    };
    updateTitle();

    const mountView = (): void => {
      this.calViewInstance?.destroy();
      viewContainer.setAttribute('view', this.calViewType);
      const tasks = this.store.getTasks();
      const cfg: ResolvedConfig = {
        ...config,
        startPosition: this.calDate.format(this.calViewType === 'week' ? 'YYYY-ww' : 'YYYY-MM'),
      };
      if (this.calViewType === 'month') {
        this.calViewInstance = new MonthView({
          onToggle: (t) => { void this.store.toggleTask(t); },
          onCellClick: () => {},
          onWeekClick: (wk, yr) => {
            this.calViewType = 'week';
            this.calDate = window.moment().isoWeekYear(parseInt(yr, 10)).isoWeek(parseInt(wk, 10)).startOf('isoWeek');
            this.render();
          },
        });
      } else if (this.calViewType === 'week') {
        this.calViewInstance = new WeekView({
          onToggle: (t) => { void this.store.toggleTask(t); },
          onCellClick: () => {},
        });
      } else {
        this.calViewInstance = new ListView({
          onToggle: (t) => { void this.store.toggleTask(t); },
          onDateClick: () => {},
        });
      }
      this.calViewInstance.render(viewContainer, tasks, cfg);
    };

    mountView();

    prevBtn.addEventListener('click', () => {
      if (this.calViewType === 'week') {
        this.calDate = window.moment(this.calDate).subtract(7, 'days').startOf('isoWeek');
      } else {
        this.calDate = window.moment(this.calDate).subtract(1, 'months').date(1);
      }
      updateTitle();
      mountView();
    });

    nextBtn.addEventListener('click', () => {
      if (this.calViewType === 'week') {
        this.calDate = window.moment(this.calDate).add(7, 'days').startOf('isoWeek');
      } else {
        this.calDate = window.moment(this.calDate).add(1, 'months').date(1);
      }
      updateTitle();
      mountView();
    });

    todayBtn.addEventListener('click', () => {
      this.calDate = this.calViewType === 'week'
        ? window.moment().startOf('isoWeek')
        : window.moment().date(1);
      updateTitle();
      mountView();
    });

    this.calUnsubscribe = this.store.onUpdate(() => mountView());
  }

  private renderSearch(): void {
    const header = this.el.createDiv({ cls: 'tc-center-header' });
    header.createEl('h2', { cls: 'tc-center-title', text: 'Search' });
    const input = header.createEl('input', {
      cls: 'tc-center-search tc-search-global',
      attr: { type: 'text', placeholder: 'Search all tasks…' },
    });
    input.value = this.state.get('searchQuery');
    input.addEventListener('input', () => this.state.set('searchQuery', input.value));
    window.setTimeout(() => input.focus(), 0);

    const query = this.state.get('searchQuery').toLowerCase();
    if (!query) return;

    const results = this.store
      .getTasks()
      .filter(
        (t) => t.text.toLowerCase().includes(query) || t.rawText.toLowerCase().includes(query),
      );
    const scroll = this.el.createDiv({ cls: 'tc-center-scroll' });
    if (results.length === 0) {
      scroll.createDiv({ cls: 'tc-center-empty', text: 'No results' });
      return;
    }
    this.renderFlat(scroll, results);
  }

  private renderGrouped(container: HTMLElement, tasks: Task[]): void {
    const today = window.moment().format('YYYY-MM-DD');
    const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');

    const groups: Array<{ label: string; tasks: Task[] }> = [
      { label: 'Overdue', tasks: [] },
      { label: 'Today', tasks: [] },
      { label: 'Tomorrow', tasks: [] },
      { label: 'Upcoming', tasks: [] },
    ];

    for (const task of tasks) {
      const d = task.due ?? task.scheduled ?? task.dailyNoteDate;
      if (!d || d < today) {
        groups[0]!.tasks.push(task);
      } else if (d === today) {
        groups[1]!.tasks.push(task);
      } else if (d === tomorrow) {
        groups[2]!.tasks.push(task);
      } else {
        groups[3]!.tasks.push(task);
      }
    }

    let firstGroup = true;
    for (const group of groups) {
      if (group.tasks.length === 0) continue;
      const cls = firstGroup ? 'tc-group-header tc-group-header--first' : 'tc-group-header';
      container.createDiv({ cls, text: `${group.label}  ${group.tasks.length}` });
      firstGroup = false;
      for (const task of group.tasks) this.renderTaskCard(container, task);
    }
  }

  private renderFlat(container: HTMLElement, tasks: Task[]): void {
    for (const task of tasks) this.renderTaskCard(container, task);
  }

  private renderTaskCard(container: HTMLElement, task: Task): void {
    const stack = this.state.get('taskStack');
    const current = stack[stack.length - 1];
    const isSelected =
      current !== undefined &&
      'line' in current &&
      current.line === task.line &&
      current.filePath === task.filePath;

    const card = container.createDiv({
      cls: `tc-task-card${isSelected ? ' is-selected' : ''}`,
    });

    // Checkbox
    const checkbox = card.createEl('input', {
      cls: 'tc-task-checkbox',
      attr: { type: 'checkbox' },
    });
    checkbox.checked = task.status === 'done';
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      void this.store.toggleTask(task);
    });

    const body = card.createDiv({ cls: 'tc-task-body' });

    // Title row
    const titleRow = body.createDiv({ cls: 'tc-task-title-row' });
    if (task.time) {
      titleRow.createEl('span', { cls: 'tc-task-time', text: task.time });
    }
    titleRow.createEl('span', { cls: 'tc-task-title', text: task.text });

    // Meta row
    const meta = body.createDiv({ cls: 'tc-task-meta' });

    if (task.description) {
      meta.createDiv({
        cls: 'tc-task-desc',
        text: task.description.split('\n')[0] ?? '',
      });
    }

    const pills = meta.createDiv({ cls: 'tc-task-pills' });
    const d = task.due ?? task.scheduled ?? task.dailyNoteDate;
    const today = window.moment().format('YYYY-MM-DD');
    const sel = this.state.get('selectedList');
    const suppressToday = sel === 'today' && d === today;
    if (d && !suppressToday) {
      pills.createEl('span', {
        cls: `tc-task-date${this.isOverdue(d) ? ' is-overdue' : ''}`,
        text: this.formatDate(d),
      });
    }
    const tags = task.rawText.match(/#[\w/-]+/gu) ?? [];
    for (const tag of tags.slice(0, 2)) {
      pills.createEl('span', { cls: 'tc-task-tag', text: tag });
    }
    if (task.subtasks?.length) {
      const done = task.subtasks.filter((s) => s.status === 'done').length;
      pills.createEl('span', {
        cls: 'tc-task-progress',
        text: `${done}/${task.subtasks.length}`,
      });
    }

    card.addEventListener('click', () => {
      this.state.set('taskStack', [task]);
    });

    // Delete button (visible on hover)
    const deleteBtn = card.createEl('button', {
      cls: 'tc-task-delete-btn',
      attr: { title: 'Delete task', 'aria-label': 'Delete task' },
      text: '×',
    });
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.deleteTask(task);
    });
  }

  private renderAddTaskBar(): void {
    const bar = this.el.createDiv({ cls: 'tc-add-task-bar' });
    const trigger = bar.createDiv({ cls: 'tc-add-task-trigger' });
    trigger.createEl('span', { cls: 'tc-add-task-plus', text: '+' });
    trigger.createEl('span', { cls: 'tc-add-task-label', text: 'Add task' });
    trigger.addEventListener('click', () => {
      trigger.remove();
      this.showQuickCapture(bar);
    });
  }

  private showQuickCapture(container: HTMLElement): void {
    const form = container.createDiv({ cls: 'tc-quick-capture' });
    const input = form.createEl('input', {
      cls: 'tc-quick-capture-input',
      attr: { type: 'text', placeholder: 'Task name…' },
    });

    const commit = (): void => {
      const text = input.value.trim();
      if (text) void this.createTask(text).then(() => this.render());
      else this.render();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') this.render();
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (activeDocument.activeElement !== input) commit();
      }, 150);
    });
    window.setTimeout(() => input.focus(), 0);
  }

  private async createTask(text: string): Promise<void> {
    const sel = this.state.get('selectedList');
    const today = window.moment().format('YYYY-MM-DD');
    const dailyFolder = this.settings.desktop.dailyNoteFolder ?? 'Daily';
    const dailyFormat = this.settings.desktop.dailyNoteFormat ?? 'YYYY-MM-DD';
    const todayPath = `${dailyFolder}/${window.moment().format(dailyFormat)}.md`;

    let filePath: string;
    let taskLine: string;

    if (sel === 'today') {
      filePath = todayPath;
      taskLine = `- [ ] ${text} 📅 ${today}`;
    } else if (sel === 'inbox') {
      filePath = this.settings.customFilePath || 'Inbox.md';
      taskLine =
        this.settings.inboxMode === 'tag'
          ? `- [ ] ${text} ${this.settings.inboxTag ?? '#inbox'}`
          : `- [ ] ${text}`;
    } else if (typeof sel === 'object' && sel.type === 'tag') {
      filePath = 'Inbox.md';
      taskLine = `- [ ] ${text} ${sel.tag}`;
    } else if (typeof sel === 'object' && sel.type === 'group') {
      const group = this.settings.tagGroups.find((g) => g.id === sel.groupId);
      const tag = group?.mode === 'prefix' ? `#${group.prefix ?? ''}` : (group?.tags?.[0] ?? '');
      filePath = 'Inbox.md';
      taskLine = tag ? `- [ ] ${text} ${tag}` : `- [ ] ${text}`;
    } else {
      filePath = todayPath;
      taskLine = `- [ ] ${text}`;
    }

    let file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      const withMd = filePath.endsWith('.md') ? filePath : `${filePath}.md`;
      file = this.app.vault.getAbstractFileByPath(withMd);
    }
    if (!(file instanceof TFile)) {
      try {
        const path = filePath.endsWith('.md') ? filePath : `${filePath}.md`;
        await this.app.vault.create(path, taskLine + '\n');
        new Notice(`Created ${filePath}`);
        return;
      } catch {
        new Notice(`Could not find task file: ${filePath}`);
        return;
      }
    }
    await this.app.vault.process(file, (data) => data.trimEnd() + '\n' + taskLine + '\n');
  }

  private async deleteTask(task: Task): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const from = task.line;
      const to = task.subtaskRange ? task.subtaskRange.to : task.line;
      lines.splice(from, to - from + 1);
      return lines.join('\n');
    });
    const stack = this.state.get('taskStack');
    const current = stack[stack.length - 1];
    if (
      current !== undefined &&
      'line' in current &&
      current.line === task.line &&
      current.filePath === task.filePath
    ) {
      this.state.set('taskStack', []);
    }
  }

  private getFilteredTasks(): Task[] {
    const sel = this.state.get('selectedList');
    const filter = this.state.get('centerFilter').toLowerCase();
    const today = window.moment().format('YYYY-MM-DD');

    let tasks: Task[];

    if (typeof sel === 'string') {
      switch (sel) {
        case 'inbox':
          tasks = this.getInboxTasks();
          break;
        case 'today':
          tasks = this.store.getTasks().filter((t) => {
            if (t.status !== 'open') return false;
            return t.due === today || t.scheduled === today || t.dailyNoteDate === today;
          });
          break;
        case 'upcoming':
          tasks = this.store
            .getTasks()
            .filter((t) => {
              if (t.status !== 'open') return false;
              const d = t.due ?? t.scheduled ?? t.dailyNoteDate;
              return d !== undefined && d > today;
            })
            .sort((a, b) => {
              const da = a.due ?? a.scheduled ?? a.dailyNoteDate ?? '';
              const db = b.due ?? b.scheduled ?? b.dailyNoteDate ?? '';
              return da.localeCompare(db);
            });
          break;
        default:
          tasks = this.store.getTasks().filter((t) => t.status === 'open');
      }
    } else if (sel.type === 'tag') {
      tasks = this.store.getTasks({ tag: sel.tag }).filter((t) => t.status === 'open');
    } else {
      // group — gather all tags in group
      const group = this.settings.tagGroups.find((g) => g.id === sel.groupId);
      tasks = this.store.getTasks().filter((t) => {
        if (t.status !== 'open') return false;
        if (!group) return false;
        if (group.mode === 'prefix' && group.prefix) {
          return t.rawText.includes(`#${group.prefix}`);
        }
        return (group.tags ?? []).some((tag) => t.rawText.includes(tag));
      });
    }

    if (filter) {
      tasks = tasks.filter(
        (t) => t.text.toLowerCase().includes(filter) || t.rawText.toLowerCase().includes(filter),
      );
    }
    return tasks;
  }

  private getInboxTasks(): Task[] {
    if (this.settings.inboxMode === 'tag') {
      const inboxTag = this.settings.inboxTag;
      return this.store.getTasks().filter((t) => {
        if (t.status !== 'open') return false;
        return t.rawText.includes(inboxTag);
      });
    }
    // 'untagged' mode: tasks with no hashtags
    return this.store.getTasks().filter((t) => {
      if (t.status !== 'open') return false;
      return !/#[\w/-]+/u.test(t.rawText);
    });
  }

  private getTitle(): string {
    const sel = this.state.get('selectedList');
    if (sel === 'inbox') return 'Inbox';
    if (sel === 'today') return 'Today';
    if (sel === 'upcoming') return 'Upcoming';
    if (typeof sel === 'object' && sel.type === 'tag') return sel.tag;
    if (typeof sel === 'object' && sel.type === 'group') {
      const group = this.settings.tagGroups.find((g) => g.id === sel.groupId);
      return group?.name ?? 'Group';
    }
    return 'Tasks';
  }

  private formatDate(d: string): string {
    const today = window.moment().format('YYYY-MM-DD');
    const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');
    if (d === today) return 'Today';
    if (d === tomorrow) return 'Tomorrow';
    const m = window.moment(d, 'YYYY-MM-DD');
    const diff = m.diff(window.moment(), 'days');
    if (diff > -7 && diff < 7) return m.format('ddd D MMM');
    return m.format('D MMM');
  }

  private isOverdue(d: string): boolean {
    return d < window.moment().format('YYYY-MM-DD');
  }
}
