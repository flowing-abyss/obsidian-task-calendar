import { Menu, Notice, TFile, setIcon, type App } from 'obsidian';
import type { AppState } from '../app/AppState';
import type { Task } from '../parser/types';
import { DEFAULT_VIEW_CONFIG } from '../settings/defaults';
import type { CalendarSettings, ResolvedConfig } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';
import type { TagManager } from '../tags/TagManager';
import { TaskModal } from '../ui/TaskModal';
import { renderSourceNoteChip, shouldShowSourceNote } from '../ui/sourceNoteChip';
import { openInFile } from '../ui/taskNavigation';
import { ListView } from '../views/ListView';
import { MonthView } from '../views/MonthView';
import { WeekView } from '../views/WeekView';
import { sortTasksByDateTime } from '../views/taskGrouping';

type CalViewType = 'month' | 'week' | 'list';

export class CenterPanel {
  private el!: HTMLElement;
  private offs: Array<() => void> = [];
  private calViewType: CalViewType = 'month';
  private calDate = window.moment().date(1);
  private calViewInstance: MonthView | WeekView | ListView | null = null;
  private calUnsubscribe: (() => void) | null = null;
  private taskModal: TaskModal | null = null;
  private calStyle: string = 'style1';

  constructor(
    private state: AppState,
    private store: TaskStore,
    private app: App,
    private settings: CalendarSettings,
    private tagManager: TagManager,
  ) {}

  mount(container: HTMLElement): void {
    this.el = container;
    this.taskModal = new TaskModal(this.app, this.settings);
    this.calStyle = this.settings.desktop.style ?? 'style1';
    this.offs.push(
      this.state.on('selectedList', () => this.render()),
      this.state.on('mode', () => this.render()),
      this.state.on('centerFilter', () => this.render()),
      this.state.on('searchQuery', () => this.render()),
      this.state.on('taskStack', () => {
        const stack = this.state.get('taskStack');
        const current = stack[stack.length - 1];
        this.el.querySelectorAll<HTMLElement>('.tc-task-card').forEach((card) => {
          const isSelected =
            current !== undefined &&
            card.dataset['filePath'] === current.filePath &&
            card.dataset['line'] === String(current.line);
          card.classList.toggle('is-selected', isSelected);
        });
      }),
    );
    this.render();
  }

  refresh(): void {
    this.render();
  }

  destroy(): void {
    this.taskModal?.close();
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

    // Left group: [<] [Month] [Year] [>]
    const leftGroup = nav.createDiv({ cls: 'tc-cal-nav-left' });
    const prevBtn = leftGroup.createEl('button', {
      cls: 'tc-cal-nav-btn',
      attr: { 'aria-label': 'Previous' },
    });
    setIcon(prevBtn, 'chevron-left');

    const titleGroup = leftGroup.createDiv({ cls: 'tc-cal-nav-title-group' });
    const monthBtn = titleGroup.createEl('button', { cls: 'tc-cal-nav-month' });
    const yearBtn = titleGroup.createEl('button', { cls: 'tc-cal-nav-year' });

    const nextBtn = leftGroup.createEl('button', {
      cls: 'tc-cal-nav-btn',
      attr: { 'aria-label': 'Next' },
    });
    setIcon(nextBtn, 'chevron-right');

    // Right group: [Today] [Month|Week|List switcher] [🎨]
    const rightGroup = nav.createDiv({ cls: 'tc-cal-nav-right' });
    const todayBtn = rightGroup.createEl('button', {
      cls: 'tc-cal-nav-today',
      text: 'Today',
    });

    const viewSwitcher = rightGroup.createDiv({ cls: 'tc-cal-view-switcher' });
    const CAL_VIEWS = ['month', 'week', 'list'] as const;
    for (const v of CAL_VIEWS) {
      const btn = viewSwitcher.createEl('button', {
        cls: `tc-cal-view-btn${this.calViewType === v ? ' is-active' : ''}`,
        text: v.charAt(0).toUpperCase() + v.slice(1),
      });
      btn.addEventListener('click', () => {
        this.calViewType = v;
        if (v === 'week') {
          this.calDate = window.moment().startOf('isoWeek');
        } else {
          this.calDate = window.moment().date(1);
        }
        this.render();
      });
    }

    const viewContainer = this.el.createDiv({
      cls: `tc-cal-body tasksCalendar ${this.calStyle}`,
    });

    // Style picker only applies to week view (CSS style variants only defined for week)
    if (this.calViewType === 'week') {
      const CAL_STYLES = [
        'style1',
        'style2',
        'style3',
        'style4',
        'style5',
        'style6',
        'style7',
        'style8',
        'style9',
        'style10',
        'style11',
      ];
      const styleBtn = rightGroup.createEl('button', {
        cls: 'tc-cal-style-btn',
        attr: { title: `Style: ${this.calStyle}`, 'aria-label': 'Cycle calendar style' },
        text: '🎨',
      });
      styleBtn.addEventListener('click', () => {
        const idx = CAL_STYLES.indexOf(this.calStyle);
        this.calStyle = CAL_STYLES[(idx + 1) % CAL_STYLES.length] ?? 'style1';
        viewContainer.className = `tc-cal-body tasksCalendar ${this.calStyle}`;
        viewContainer.setAttribute('view', this.calViewType);
        styleBtn.setAttribute('title', `Style: ${this.calStyle}`);
        mountView();
      });
    }

    const updateTitle = (): void => {
      if (this.calViewType === 'week') {
        monthBtn.textContent = `Week ${this.calDate.format('w')}`;
        yearBtn.textContent = this.calDate.format('YYYY');
      } else {
        monthBtn.textContent = this.calDate.format('MMMM');
        yearBtn.textContent = this.calDate.format('YYYY');
      }
    };
    updateTitle();

    const handleTaskClick = (t: Task): void => {
      this.taskModal?.open(t);
    };

    const handleDrop = (dragData: string, targetDate: string): void => {
      void this.rescheduleTask(dragData, targetDate);
    };

    const mountView = (): void => {
      this.calViewInstance?.destroy();
      viewContainer.empty();
      viewContainer.setAttribute('view', this.calViewType);
      const tasks = this.store.getTasks();
      const cfg: ResolvedConfig = {
        ...DEFAULT_VIEW_CONFIG,
        ...this.settings.desktop,
        isMobile: false,
        sourceNoteDisplay: this.settings.sourceNoteDisplay,
        customFilePath: this.settings.customFilePath,
        startPosition: this.calDate.format(this.calViewType === 'week' ? 'YYYY-ww' : 'YYYY-MM'),
      };
      if (this.calViewType === 'month') {
        this.calViewInstance = new MonthView({
          onToggle: (t) => {
            void this.store.toggleTask(t);
          },
          onCellClick: () => {},
          onWeekClick: (wk, yr) => {
            this.calViewType = 'week';
            this.calDate = window
              .moment()
              .isoWeekYear(parseInt(yr, 10))
              .isoWeek(parseInt(wk, 10))
              .startOf('isoWeek');
            this.render();
          },
          onTaskClick: handleTaskClick,
          onDrop: handleDrop,
        });
      } else if (this.calViewType === 'week') {
        this.calViewInstance = new WeekView({
          onToggle: (t) => {
            void this.store.toggleTask(t);
          },
          onCellClick: () => {},
          onTaskClick: handleTaskClick,
          onDrop: handleDrop,
        });
      } else {
        this.calViewInstance = new ListView({
          onToggle: (t) => {
            void this.store.toggleTask(t);
          },
          onDateClick: () => {},
          onTaskClick: handleTaskClick,
        });
      }
      this.calViewInstance.render(viewContainer, tasks, cfg);
    };

    mountView();

    // Month picker popover
    monthBtn.addEventListener('click', () => {
      const existing = this.el.querySelector('.tc-month-picker');
      if (existing) {
        existing.remove();
        return;
      }
      const picker = this.el.createDiv({ cls: 'tc-month-picker tc-popover' });
      const MONTH_NAMES = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      MONTH_NAMES.forEach((m, i) => {
        const btn = picker.createEl('button', { cls: 'tc-month-picker-btn', text: m });
        if (i === this.calDate.month()) btn.addClass('is-active');
        btn.addEventListener('click', () => {
          this.calDate = this.calDate.clone().month(i).date(1);
          updateTitle();
          mountView();
          picker.remove();
        });
      });
      monthBtn.after(picker);
      window.setTimeout(() => {
        const dismiss = (e: MouseEvent): void => {
          if (!picker.contains(e.target as Node) && e.target !== monthBtn) {
            picker.remove();
            activeDocument.removeEventListener('click', dismiss, true);
          }
        };
        activeDocument.addEventListener('click', dismiss, true);
      }, 0);
    });

    // Year picker popover
    yearBtn.addEventListener('click', () => {
      const existing = this.el.querySelector('.tc-year-picker');
      if (existing) {
        existing.remove();
        return;
      }
      const picker = this.el.createDiv({ cls: 'tc-year-picker tc-popover' });
      const currentYear = this.calDate.year();
      for (let y = currentYear - 5; y <= currentYear + 5; y++) {
        const btn = picker.createEl('button', {
          cls: 'tc-year-picker-btn',
          text: String(y),
        });
        if (y === currentYear) btn.addClass('is-active');
        btn.addEventListener('click', () => {
          this.calDate = this.calDate.clone().year(y).date(1);
          updateTitle();
          mountView();
          picker.remove();
        });
      }
      yearBtn.after(picker);
      window.setTimeout(() => {
        const dismiss = (e: MouseEvent): void => {
          if (!picker.contains(e.target as Node) && e.target !== yearBtn) {
            picker.remove();
            activeDocument.removeEventListener('click', dismiss, true);
          }
        };
        activeDocument.addEventListener('click', dismiss, true);
      }, 0);
    });

    prevBtn.addEventListener('click', () => {
      if (this.calViewType === 'week') {
        this.calDate = this.calDate.clone().subtract(7, 'days').startOf('isoWeek');
      } else {
        this.calDate = this.calDate.clone().subtract(1, 'months').date(1);
      }
      updateTitle();
      mountView();
    });

    nextBtn.addEventListener('click', () => {
      if (this.calViewType === 'week') {
        this.calDate = this.calDate.clone().add(7, 'days').startOf('isoWeek');
      } else {
        this.calDate = this.calDate.clone().add(1, 'months').date(1);
      }
      updateTitle();
      mountView();
    });

    todayBtn.addEventListener('click', () => {
      this.calDate =
        this.calViewType === 'week' ? window.moment().startOf('isoWeek') : window.moment().date(1);
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

    // Navigate to task in tasks mode when clicking a search result
    scroll.querySelectorAll<HTMLElement>('.tc-task-card').forEach((cardEl, idx) => {
      const task = results[idx];
      if (!task) return;
      cardEl.addEventListener(
        'click',
        (e) => {
          e.stopPropagation();
          const todayStr = window.moment().format('YYYY-MM-DD');
          const d = task.due ?? task.scheduled ?? task.dailyNoteDate;
          let list: 'inbox' | 'today' | 'upcoming' = 'inbox';
          if ((task.due && task.due < todayStr) || d === todayStr) {
            list = 'today';
          } else if (d && d > todayStr) {
            list = 'upcoming';
          }
          this.state.set('selectedList', list);
          this.state.set('mode', 'tasks');
          this.state.set('taskStack', [task]);
        },
        { capture: true },
      );
    });
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
      for (const task of sortTasksByDateTime(group.tasks)) this.renderTaskCard(container, task);
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
    card.dataset['filePath'] = task.filePath;
    card.dataset['line'] = String(task.line);

    const checkbox = card.createEl('input', {
      cls: 'tc-task-checkbox',
      attr: { type: 'checkbox' },
    });
    checkbox.checked = task.status === 'done';
    if (task.priority && task.priority !== 'D') {
      checkbox.dataset['priority'] = task.priority;
    }
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      void this.store.toggleTask(task);
    });

    // Pre-compute metadata needed in both body and meta-right
    const today = window.moment().format('YYYY-MM-DD');
    const sel = this.state.get('selectedList');
    const d = task.due ?? task.scheduled; // only explicit dates show a badge
    const tags = task.rawText.match(/#[\w/-]+/gu) ?? [];
    const subtaskCount = task.subtasks?.length ?? 0;
    const commentCount = task.comments?.length ?? 0;
    const doneCount = task.subtasks?.filter((s) => s.status === 'done').length ?? 0;
    const suppressToday = sel === 'today' && d === today;

    const body = card.createDiv({ cls: 'tc-task-body' });
    const titleRow = body.createDiv({ cls: 'tc-task-title-row' });

    // Count badges BEFORE title text so they're seen while reading left-to-right
    if (subtaskCount > 0) {
      const badge = titleRow.createEl('span', { cls: 'tc-task-count-badge' });
      setIcon(badge, 'check-square');
      badge.createEl('span', { text: `${doneCount}/${subtaskCount}` });
    }
    if (commentCount > 0) {
      const badge = titleRow.createEl('span', { cls: 'tc-task-count-badge' });
      setIcon(badge, 'message-square');
      badge.createEl('span', { text: String(commentCount) });
    }

    titleRow.createEl('span', { cls: 'tc-task-title', text: task.text });
    if (task.description) {
      body.createDiv({
        cls: 'tc-task-desc',
        text: task.description.split('\n')[0] ?? '',
      });
    }

    const showSourceNote = shouldShowSourceNote(
      task,
      this.settings.sourceNoteDisplay,
      this.settings.customFilePath,
    );
    const hasRightMeta = showSourceNote || (d && !suppressToday) || task.time || tags.length > 0;
    if (hasRightMeta) {
      const metaRight = card.createDiv({ cls: 'tc-task-meta-right' });

      // Date + optional time: use child spans for each icon to avoid setIcon replacing parent
      if (d && !suppressToday) {
        const dateEl = metaRight.createEl('span', {
          cls: `tc-task-date ${this.getDateClass(d)}`.trim(),
        });
        const calIcon = dateEl.createEl('span', { cls: 'tc-date-icon' });
        setIcon(calIcon, 'calendar');
        dateEl.createEl('span', { text: this.formatDate(d) });
        if (task.time) {
          const clockIcon = dateEl.createEl('span', { cls: 'tc-date-icon' });
          setIcon(clockIcon, 'clock');
          dateEl.createEl('span', { text: task.time });
        }
      } else if (!d && task.time) {
        const timeEl = metaRight.createEl('span', { cls: 'tc-task-date' });
        const clockIcon = timeEl.createEl('span', { cls: 'tc-date-icon' });
        setIcon(clockIcon, 'clock');
        timeEl.createEl('span', { text: task.time });
      }

      // Source note chip before tags
      if (showSourceNote) {
        renderSourceNoteChip(metaRight, task);
      }

      // Tags last (max 2, with group color)
      for (const tag of tags.slice(0, 2)) {
        const tagEl = metaRight.createEl('span', { cls: 'tc-task-tag', text: tag });
        const color = this.getTagColor(tag);
        if (color) {
          tagEl.setCssProps({ '--tc-tag-color': color });
          tagEl.addClass('tc-task-tag--colored');
        }
        // Drop target: dragging a tag onto a chip replaces it
        tagEl.addEventListener('dragover', (e) => {
          const dragging = this.state.get('draggingTag');
          if (!dragging || dragging === tag) return;
          e.preventDefault();
          e.stopPropagation();
          tagEl.classList.add('tc-drop-target');
        });
        tagEl.addEventListener('dragleave', () => {
          tagEl.classList.remove('tc-drop-target');
        });
        tagEl.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          tagEl.classList.remove('tc-drop-target');
          const dragging = this.state.get('draggingTag');
          if (!dragging || dragging === tag) return;
          void this.tagManager.replaceTagOnTask(task, tag, dragging);
        });
      }
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

    // Drag source
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', () => {
      this.state.set('draggingTask', task);
      card.classList.add('tc-dragging');
    });
    card.addEventListener('dragend', () => {
      this.state.set('draggingTask', null);
      card.classList.remove('tc-dragging');
    });

    // Drop target for tag→task drag
    card.addEventListener('dragover', (e) => {
      if (!this.state.get('draggingTag')) return;
      e.preventDefault();
      card.classList.add('tc-drop-target');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('tc-drop-target');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('tc-drop-target');
      const tag = this.state.get('draggingTag');
      if (!tag) return;
      void this.tagManager.assignTagFromInbox(task, tag);
    });

    // Right-click context menu
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      for (const pinnedTag of this.settings.pinnedTags) {
        const hasTag = task.rawText.includes(pinnedTag);
        menu.addItem((item) =>
          item
            .setTitle(`${hasTag ? '✓ ' : ''}${pinnedTag}`)
            .setIcon('tag')
            .onClick(() => {
              void this.tagManager.toggleTagOnTask(task, pinnedTag);
            }),
        );
      }
      if (this.settings.pinnedTags.length > 0) menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle('Open file')
          .setIcon('file-text')
          .onClick(() => {
            void openInFile(this.app, task);
          }),
      );
      menu.showAtMouseEvent(e);
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

    let committed = false;
    const commit = (): void => {
      if (committed) return;
      committed = true;
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

    // Today view: delegate fully to store (resolver handles file + prefix + date)
    if (sel === 'today' || sel === 'upcoming') {
      await this.store.addTask(today, text);
      return;
    }

    // Dateless contexts: build raw line, then route via resolver or fallback file
    let taskLine: string;
    let fallbackPath: string;

    if (sel === 'inbox') {
      taskLine =
        this.settings.inbox.mode !== 'untagged'
          ? `- [ ] ${text} ${this.settings.inbox.tag}`
          : `- [ ] ${text}`;
      fallbackPath = this.settings.customFilePath || 'Inbox.md';
    } else if (typeof sel === 'object' && sel.type === 'tag') {
      taskLine = `- [ ] ${text} ${sel.tag}`;
      fallbackPath = this.settings.customFilePath || 'Inbox.md';
    } else if (typeof sel === 'object' && sel.type === 'group') {
      const group = this.settings.tagGroups.find((g) => g.id === sel.groupId);
      const tag = group?.mode === 'prefix' ? `#${group.prefix ?? ''}` : (group?.tags?.[0] ?? '');
      taskLine = tag ? `- [ ] ${text} ${tag}` : `- [ ] ${text}`;
      fallbackPath = this.settings.customFilePath || 'Inbox.md';
    } else {
      await this.store.addTask(today, text);
      return;
    }

    if (this.settings.addToToday) {
      await this.store.addRawLine(taskLine);
      return;
    }

    // addToToday off: write to fallback file
    let file = this.app.vault.getAbstractFileByPath(fallbackPath);
    if (!(file instanceof TFile)) {
      const withMd = fallbackPath.endsWith('.md') ? fallbackPath : `${fallbackPath}.md`;
      file = this.app.vault.getAbstractFileByPath(withMd);
    }
    if (!(file instanceof TFile)) {
      try {
        const path = fallbackPath.endsWith('.md') ? fallbackPath : `${fallbackPath}.md`;
        await this.app.vault.create(path, taskLine + '\n');
        new Notice(`Created ${fallbackPath}`);
        return;
      } catch {
        new Notice(`Could not find task file: ${fallbackPath}`);
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
        case 'today': {
          const todayStr = window.moment().format('YYYY-MM-DD');
          tasks = this.store.getTasks().filter((t) => {
            if (t.status !== 'open') return false;
            if (t.due === todayStr || t.scheduled === todayStr || t.dailyNoteDate === todayStr)
              return true;
            if (t.due && t.due < todayStr) return true;
            return false;
          });
          break;
        }
        case 'upcoming': {
          const filtered = this.store.getTasks().filter((t) => {
            if (t.status !== 'open') return false;
            const d = t.due ?? t.scheduled ?? t.dailyNoteDate;
            return d !== undefined && d > today;
          });
          tasks = sortTasksByDateTime(filtered);
          break;
        }
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
    const { inbox } = this.settings;
    const allOpen = this.store.getTasks().filter((t) => t.status === 'open');
    const withTag =
      inbox.mode !== 'untagged' ? allOpen.filter((t) => t.rawText.includes(inbox.tag)) : [];
    const includeUntagged = inbox.mode !== 'tag' || inbox.showUntagged;
    const untagged = includeUntagged ? allOpen.filter((t) => !/#[\w/-]+/u.test(t.rawText)) : [];
    if (withTag.length === 0) return untagged;
    if (untagged.length === 0) return withTag;
    const seen = new Set<string>();
    return [...withTag, ...untagged].filter((t) => {
      const key = `${t.filePath}:${t.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
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

  private getDateClass(d: string): string {
    const today = window.moment().format('YYYY-MM-DD');
    if (d < today) return 'is-overdue';
    if (d === today) return 'is-today';
    const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');
    if (d === tomorrow) return 'is-tomorrow';
    const dayAfter = window.moment().add(2, 'days').format('YYYY-MM-DD');
    if (d === dayAfter) return 'is-soon';
    return '';
  }

  private getTagColor(tag: string): string | undefined {
    const noHash = tag.replace(/^#/, '');
    for (const group of this.settings.tagGroups) {
      if (group.mode === 'prefix' && group.prefix) {
        if (noHash === group.prefix || noHash.startsWith(`${group.prefix}/`)) {
          return group.color;
        }
      } else if (group.mode === 'manual' && group.tags) {
        if (group.tags.includes(tag) || group.tags.includes(noHash)) {
          return group.color;
        }
      }
    }
    return undefined;
  }

  private async rescheduleTask(dragData: string, targetDate: string): Promise<void> {
    const parts = dragData.split(':::');
    if (parts.length < 2) return;
    const [filePath, lineStr] = parts;
    const line = parseInt(lineStr ?? '0', 10);
    if (!filePath || isNaN(line)) return;

    const task = this.store.getTasks().find((t) => t.filePath === filePath && t.line === line);
    if (!task) return;

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    await this.app.vault.process(file, (content) => {
      const lines = content.split('\n');
      const taskLine = lines[line];
      if (!taskLine) return content;

      let updated: string;
      if (task.due) {
        updated = taskLine.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${targetDate}`);
      } else if (task.scheduled) {
        updated = taskLine.replace(/⏳\s*\d{4}-\d{2}-\d{2}/u, `⏳ ${targetDate}`);
      } else {
        updated = taskLine.trimEnd() + ` 📅 ${targetDate}`;
      }

      if (updated === taskLine && (task.due || task.scheduled)) {
        // Regex didn't match — task likely shifted lines; abort silently with no-op
        return content;
      }

      lines[line] = updated;
      return lines.join('\n');
    });
  }

  private async toggleDueToday(task: Task): Promise<void> {
    const today = window.moment().format('YYYY-MM-DD');
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      let updated: string;
      if (task.due === today) {
        // Toggle off: remove the due date
        updated = line.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, '').replace(/\s{2,}/gu, ' ').trimEnd();
      } else if (task.due) {
        // Replace existing due date with today
        updated = line.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${today}`);
      } else {
        // No due date — append today
        updated = line.trimEnd() + ` 📅 ${today}`;
      }
      lines[task.line] = updated;
      return lines.join('\n');
    });
  }

  private async setPriority(task: Task, priority: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const PRIORITY_EMOJIS = ['🔺', '⏫', '🔼', '🔽', '⏬'] as const;
    const PRIORITY_MAP: Record<string, string> = { A: '🔺', B: '⏫', C: '🔼', E: '🔽', F: '⏬' };
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      let updated = line;
      for (const emoji of PRIORITY_EMOJIS) updated = updated.replace(emoji, '');
      if (priority !== 'D' && PRIORITY_MAP[priority])
        updated = updated.trimEnd() + ` ${PRIORITY_MAP[priority]}`;
      lines[task.line] = updated.replace(/\s{2,}/gu, ' ').trimEnd();
      return lines.join('\n');
    });
  }
}
