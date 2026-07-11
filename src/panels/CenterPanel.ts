import { Component, Menu, Notice, setIcon, TFile, type App, type MenuItem } from 'obsidian';
import type { AppState } from '../app/AppState';
import {
  isListViewCustomized,
  listSelectionToKey,
  normalizeStatusGroups,
  statusGroupsEqual,
} from '../app/listViewState';
import {
  insertTaskBlockIntoContent,
  locatorOf,
  rewriteLinkInTask,
  TaskMutationService,
} from '../mutation';
import { formatDurationFromMinutes, formatTaskLine } from '../parser/TaskParser';
import type { LinkToken } from '../parser/links';
import type { Task, TaskPriority } from '../parser/types';
import { PRIORITY_LEVELS } from '../priority';
import type { ProjectManager } from '../projects/ProjectManager';
import type { ProjectStore } from '../projects/ProjectStore';
import { DEFAULT_VIEW_CONFIG, getListViewDefaults } from '../settings/defaults';
import type {
  CalendarSettings,
  ListViewState,
  PropertyFilter,
  ResolvedConfig,
  TaskStatusType,
} from '../settings/types';
import { ACTIVE_STATUS_GROUPS, ALL_STATUS_GROUPS, TYPE_LABELS } from '../status/statusConstants';
import type { TaskStore } from '../store/TaskStore';
import type { TagManager } from '../tags/TagManager';
import { LinkEditModal } from '../ui/LinkEditModal';
import { renderStatusMarker } from '../ui/StatusMarker';
import { TagPickerModal } from '../ui/TagPickerModal';
import { TaskModal } from '../ui/TaskModal';
import { renderTaskText } from '../ui/renderTaskText';
import { renderSourceNoteChip, shouldShowSourceNote } from '../ui/sourceNoteChip';
import { buildStatusSubmenu, showStatusMenuAt } from '../ui/statusMenu';
import { openInFile } from '../ui/taskNavigation';
import { MonthGridView } from '../views/MonthGridView';
import { TodayView } from '../views/TodayView';
import { WeekTimeGridView } from '../views/WeekTimeGridView';
import {
  filterTasksByStatusGroups,
  groupTasksByDate,
  groupTasksByPriority,
  groupTasksByStatus,
  groupTasksByTag,
  sortTasksByField,
} from '../views/taskGrouping';
import {
  minutesToPixels,
  minutesToTimeString,
  timeStringToMinutes,
} from '../views/timegrid/layout';
import { ProjectsPanel } from './projects/ProjectsPanel';
import { visibleCalendarDates, type CalViewType } from './visibleCalendarDates';

function projectNameFromPath(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

/**
 * Colors a priority-submenu flag icon to match the rest of the UI (status
 * popover flags, flag settings, etc.) by tagging the item's undocumented
 * `.dom` element — Obsidian doesn't expose per-item icon styling otherwise.
 */
function applyPriorityFlagColor(si: MenuItem, value: TaskPriority): void {
  const dom = (si as unknown as { dom?: HTMLElement }).dom;
  if (dom) {
    dom.addClass('tc-menu-priority-flag');
    dom.setAttribute('data-tc-priority', value);
  }
}

/** Obsidian's MenuItem.setSubmenu() is undocumented; reach it via one shared cast. */
function getSubmenu(item: MenuItem): Menu {
  return (item as unknown as { setSubmenu(): Menu }).setSubmenu();
}

export class CenterPanel {
  private el!: HTMLElement;
  private offs: Array<() => void> = [];
  private calViewType: CalViewType = 'month';
  private calDate = window.moment().date(1);
  private calViewInstance: TodayView | WeekTimeGridView | MonthGridView | null = null;
  private calUnsubscribe: (() => void) | null = null;
  // Task 27: mountView() destroys and recreates a fresh view instance on every render — including
  // reactive re-renders driven by TaskStore updates (any task edit anywhere) — so the view
  // instance itself can't remember "did I already scroll-to-now for this view/date". This key
  // (last `${calViewType}:${startPosition}` CenterPanel actually scrolled for) survives that
  // destroy/recreate cycle because it lives on CenterPanel, not on the torn-down view.
  private lastScrolledCalKey: string | null = null;
  // Task 31: render()'s calendar branch calls `this.el.empty()` (destroying the current
  // `.tc-tg-grid-row`) *before* mountView() runs, on every reactive re-render (via PanelView's
  // store.onUpdate -> center.refresh() -> render()) — not just on the calUnsubscribe -> mountView()
  // path mountView() itself guards against. This carries the pre-empty() scrollTop across that
  // gap; mountView() consumes (and clears) it as a fallback when its own viewContainer-local read
  // finds nothing (i.e. on a freshly (re)built viewContainer).
  private pendingCalScrollTop: number | undefined = undefined;
  private taskModal: TaskModal | null = null;
  private selectedTaskKeys = new Set<string>();
  private lastClickedTaskKey: string | null = null;
  private currentListKey: string = 'today';
  private filterDebounce = 0;
  private refocusSearch = false;
  // Set true while a status-group toggle click is in flight, so that the
  // full re-render triggered by updateViewState re-opens the popover with
  // the "Status group" row still expanded (multi-select shouldn't close on pick).
  private reopenStatusGroupPopover = false;
  private onSaveSettings: () => Promise<void>;
  private mutations: TaskMutationService;
  private md = new Component();

  private projectsPanel: ProjectsPanel | null = null;

  constructor(
    private state: AppState,
    private store: TaskStore,
    private app: App,
    private settings: CalendarSettings,
    private tagManager: TagManager,
    onSaveSettings: () => Promise<void> = async () => {},
    private projectStore: ProjectStore | null = null,
    private projectManager: ProjectManager | null = null,
  ) {
    this.onSaveSettings = onSaveSettings;
    this.mutations = new TaskMutationService(app);
  }

  mount(container: HTMLElement): void {
    this.el = container;
    this.taskModal = new TaskModal(this.app, this.settings, this.store);

    // Initialize per-list state before first render
    const initialKey = listSelectionToKey(this.state.get('selectedList'));
    this.currentListKey = initialKey;
    const initialVs: ListViewState =
      this.settings.listViewStates?.[initialKey] ?? getListViewDefaults(initialKey);
    this.state.set('centerListViewState', initialVs);

    this.offs.push(
      this.state.on('selectedList', (newSel) => {
        // Save current state for the old list key
        const oldKey = this.currentListKey;
        const currentVs = this.state.get('centerListViewState');
        if (!this.settings.listViewStates) this.settings.listViewStates = {};
        this.settings.listViewStates[oldKey] = currentVs;
        void this.onSaveSettings();

        // Load state for new list
        const newKey = listSelectionToKey(newSel);
        this.currentListKey = newKey;
        const saved = this.settings.listViewStates?.[newKey];
        const nextVs = saved ?? getListViewDefaults(newKey);
        this.state.set('centerListViewState', nextVs);
        this.state.set('centerFilter', '');

        this.selectedTaskKeys.clear();
        this.lastClickedTaskKey = null;
      }),
      this.state.on('centerListViewState', () => this.render()),
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
    this.el.setAttribute('tabindex', '0');
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && this.selectedTaskKeys.size > 0) {
        this.selectedTaskKeys.clear();
        this.lastClickedTaskKey = null;
        this.updateSelectionVisuals();
        return;
      }

      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.shiftKey) {
        e.preventDefault();
        const allCards = Array.from(this.el.querySelectorAll<HTMLElement>('.tc-task-card'));
        const keys = allCards.map(
          (c) => `${c.dataset['filePath'] ?? ''}:${c.dataset['line'] ?? ''}`,
        );
        const anchorIdx = this.lastClickedTaskKey ? keys.indexOf(this.lastClickedTaskKey) : -1;
        if (anchorIdx === -1) return;

        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const nextIdx = Math.max(0, Math.min(keys.length - 1, anchorIdx + delta));
        const nextKey = keys[nextIdx];
        if (!nextKey) return;

        this.selectedTaskKeys.add(this.lastClickedTaskKey!);
        this.selectedTaskKeys.add(nextKey);
        this.lastClickedTaskKey = nextKey;
        this.updateSelectionVisuals();
      }
    };
    this.el.addEventListener('keydown', onKeyDown);
    this.offs.push(() => this.el.removeEventListener('keydown', onKeyDown));
  }

  refresh(): void {
    this.render();
  }

  destroy(): void {
    this.taskModal?.close();
    window.clearTimeout(this.filterDebounce);
    this.offs.forEach((f) => f());
    this.destroyCalendarView();
    this.destroyProjectsPanel();
    this.md.unload();
    this.el?.empty();
  }

  private destroyProjectsPanel(): void {
    this.projectsPanel?.destroy();
    this.projectsPanel = null;
  }

  /** Renders a project's tasks (reusing the card component) plus an add bar that writes into the note. */
  private renderProjectTasks(host: HTMLElement, path: string): void {
    const tasks = this.store.getTasks().filter((t) => t.filePath === path);
    const scroll = host.createDiv({ cls: 'tc-center-scroll tc-project-tasks-scroll' });
    if (tasks.length === 0) {
      scroll.createDiv({ cls: 'tc-center-empty', text: 'No tasks yet' });
    } else {
      for (const task of tasks) this.renderTaskCard(scroll, task);
    }

    const bar = host.createDiv({ cls: 'tc-add-task-bar' });
    const trigger = bar.createDiv({ cls: 'tc-add-task-trigger' });
    trigger.createEl('span', { cls: 'tc-add-task-plus', text: '+' });
    trigger.createEl('span', { cls: 'tc-add-task-label', text: 'Add task' });
    bar.addEventListener('click', () => {
      if (bar.querySelector('.tc-quick-capture')) return;
      trigger.remove();
      const form = bar.createDiv({ cls: 'tc-quick-capture' });
      const input = form.createEl('input', {
        cls: 'tc-quick-capture-input',
        attr: { type: 'text', placeholder: 'Task name…' },
      });
      let committed = false;
      const commit = (): void => {
        if (committed) return;
        committed = true;
        const text = input.value.trim();
        const file = this.app.vault.getAbstractFileByPath(path);
        if (text && file instanceof TFile) {
          void this.appendTaskToNote(file, `- [ ] ${text}`);
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') {
          // Cancel: block the pending blur→commit so nothing is written.
          committed = true;
          this.projectsPanel?.refresh();
        }
      });
      input.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (activeDocument.activeElement !== input) commit();
        }, 150);
      });
      window.setTimeout(() => input.focus(), 0);
    });
  }

  private destroyCalendarView(): void {
    this.calUnsubscribe?.();
    this.calUnsubscribe = null;
    this.calViewInstance?.destroy();
    this.calViewInstance = null;
  }

  private render(): void {
    this.md.unload();
    this.md = new Component();
    this.md.load();

    const mode = this.state.get('mode');

    if (mode !== 'projects') this.destroyProjectsPanel();

    if (mode === 'calendar') {
      // Task 31: a reactive re-render arrives here too (PanelView's store.onUpdate ->
      // center.refresh() -> render(), independent of the calUnsubscribe -> mountView() path
      // below), and `this.el.empty()` on the next line destroys the current `.tc-tg-grid-row`
      // before mountView() ever gets a chance to read it — capture it now so mountView() (see
      // its `preservedScrollTop` fallback) can still restore it on the fresh instance.
      this.pendingCalScrollTop = this.el.querySelector<HTMLElement>('.tc-tg-grid-row')?.scrollTop;
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

    if (mode === 'projects') {
      this.el.addClass('tc-center--projects');
      if (this.projectStore && this.projectManager) {
        // Rebuild the panel fresh; it owns its own subscriptions and cleans them
        // up in destroy(), so recreating on each render is leak-free.
        this.destroyProjectsPanel();
        this.projectsPanel = new ProjectsPanel(
          this.state,
          this.projectStore,
          this.projectManager,
          this.settings,
          this.app,
          { renderTasks: (host, path) => this.renderProjectTasks(host, path) },
        );
        // Mount into a dedicated child so ProjectsPanel's own class/DOM never
        // lands on the shared center element (which would leak layout into tasks mode).
        const host = this.el.createDiv({ cls: 'tc-projects-host' });
        this.projectsPanel.mount(host);
      } else {
        this.el.createDiv({ cls: 'tc-center-empty', text: 'Projects unavailable' });
      }
      return;
    }
    this.el.removeClass('tc-center--projects');

    // Header: title + right-aligned [chips] [↕] [search]
    const header = this.el.createDiv({ cls: 'tc-center-header' });
    header.createEl('h2', { cls: 'tc-center-title', text: this.getTitle() });

    const controls = header.createDiv({ cls: 'tc-center-controls' });
    this.renderPropertyChips(controls);
    this.renderViewStateButton(controls);

    const searchInput = controls.createEl('input', {
      cls: 'tc-center-search',
      attr: { type: 'text', placeholder: 'Filter…', 'aria-label': 'Filter tasks' },
    });
    searchInput.value = this.state.get('centerFilter');
    // Restore focus + caret after a debounced filter re-render so typing stays smooth.
    if (this.refocusSearch) {
      this.refocusSearch = false;
      window.setTimeout(() => {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }, 0);
    }
    // Debounce: each keystroke would otherwise re-render the whole list (running the
    // markdown pipeline per task) — costly at hundreds of tasks. Apply after a pause.
    searchInput.addEventListener('input', () => {
      window.clearTimeout(this.filterDebounce);
      this.filterDebounce = window.setTimeout(() => {
        this.refocusSearch = true;
        this.state.set('centerFilter', searchInput.value);
      }, 150);
    });

    const tasks = this.getFilteredTasks();
    const scroll = this.el.createDiv({ cls: 'tc-center-scroll' });

    if (tasks.length === 0) {
      scroll.createDiv({ cls: 'tc-center-empty', text: 'No tasks' });
    } else {
      this.renderWithGrouping(scroll, tasks);
    }

    this.renderAddTaskBar();
    this.updateSelectionVisuals();
  }

  private renderCalendarMode(): void {
    const nav = this.el.createDiv({ cls: 'tc-cal-nav' });

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

    const rightGroup = nav.createDiv({ cls: 'tc-cal-nav-right' });
    const todayBtn = rightGroup.createEl('button', { cls: 'tc-cal-nav-today', text: 'Today' });

    const viewSwitcher = rightGroup.createDiv({ cls: 'tc-cal-view-switcher' });
    const CAL_VIEWS = ['today', 'week', 'month'] as const;
    for (const v of CAL_VIEWS) {
      const btn = viewSwitcher.createEl('button', {
        cls: `tc-cal-view-btn${this.calViewType === v ? ' is-active' : ''}`,
        text: v === 'today' ? 'Day' : v.charAt(0).toUpperCase() + v.slice(1),
      });
      btn.addEventListener('click', () => {
        this.calViewType = v;
        if (v === 'week') this.calDate = window.moment().startOf('isoWeek');
        else if (v === 'today') this.calDate = window.moment();
        else this.calDate = window.moment().date(1);
        this.render();
      });
    }

    const viewContainer = this.el.createDiv({ cls: 'tc-cal-body' });

    const updateTitle = (): void => {
      if (this.calViewType === 'week') {
        monthBtn.textContent = `Week ${this.calDate.format('w')}`;
        yearBtn.textContent = this.calDate.format('YYYY');
      } else if (this.calViewType === 'today') {
        monthBtn.textContent = this.calDate.format('MMMM D');
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
    const handleDropTime = (dragData: string, date: string, time: string): void => {
      void this.setTaskTimeFromDrop(dragData, date, time);
    };
    const handleTimeChange = (t: Task, newStartMinutes: number): void => {
      void this.updateTaskTime(t, newStartMinutes);
    };
    const handleDurationChange = (t: Task, newDurationMinutes: number): void => {
      void this.updateTaskDuration(t, newDurationMinutes);
    };
    const handleStartChange = (t: Task, newStart: string): void => {
      void this.updateTaskStart(t, newStart);
    };
    const handleDueChange = (t: Task, newDue: string): void => {
      void this.rescheduleTaskDue(t, newDue);
    };
    const handleExtendToSpan = (t: Task, newDue: string): void => {
      void this.extendTaskToSpan(t, newDue);
    };
    const handleCreateAtTime = (date: string, time: string): void => {
      const dayColumn = viewContainer.querySelector<HTMLElement>(
        `.tc-tg-day-column[data-tg-date="${date}"]`,
      );
      const hourColumnEl = dayColumn?.querySelector<HTMLElement>('.tc-tg-hour-column');
      if (!hourColumnEl) return;
      this.showTimeGridQuickAdd(hourColumnEl, date, time, mountView);
    };
    const handleCreateAtDate = (date: string): void => {
      const cell = viewContainer.querySelector<HTMLElement>(`[data-mg-date="${date}"]`);
      if (!cell) return;
      this.showFillCellQuickAdd(cell, date, 'tc-mg-quick-add', mountView);
    };
    const handleCreateAtDateAllDay = (date: string): void => {
      // Scoped to .tc-tg-allday-cell specifically: HourGrid.ts's day-column element also
      // carries data-tg-date (for edge-resize date resolution), so a bare attribute selector
      // would risk matching the wrong element.
      const cell = viewContainer.querySelector<HTMLElement>(
        `.tc-tg-allday-cell[data-tg-date="${date}"]`,
      );
      if (!cell) return;
      this.showFillCellQuickAdd(cell, date, 'tc-tg-allday-quick-add', mountView);
    };

    const startPositionFor = (viewType: CalViewType, firstDayOfWeek: number): string => {
      if (viewType === 'week') {
        // Task 42b: moment's non-ISO 'ww' token always numbers weeks Sunday-first, so
        // `calDate.format('YYYY-ww')` round-trips to a label whose reconstructed anchor is
        // always literally a Sunday — regardless of which day of that week `calDate` actually
        // is (WeekTimeGridView.render, downstream, then shifts that Sunday anchor forward by
        // `firstDayOfWeek` days to land on the user's configured week-start). That forward
        // shift is only correct when `calDate` itself falls *after* the anchor within the same
        // Sunday-first week (true for Mon-Sat calDate) — for a calDate that IS itself a Sunday,
        // the anchor reconstructs to that exact same Sunday, and shifting forward by
        // `firstDayOfWeek` (e.g. 1 for Monday-first) walks a full extra week ahead, entirely
        // excluding `calDate` from the rendered range. Shifting calDate itself back by
        // `firstDayOfWeek` days *before* formatting compensates: it lands the round-trip's
        // reconstructed Sunday-anchor `firstDayOfWeek` days earlier too, so the downstream
        // forward-shift-by-firstDayOfWeek lands back on the correct 7-day window for every
        // weekday of calDate, Sunday included.
        return this.calDate.clone().subtract(firstDayOfWeek, 'days').format('YYYY-ww');
      }
      if (viewType === 'today') return this.calDate.format('YYYY-MM-DD');
      return this.calDate.format('YYYY-MM');
    };

    const mountView = (): void => {
      // Task 31: before tearing down the currently-mounted view, capture its scroll position so
      // it can be restored on the fresh instance below. A freshly-created `.tc-tg-grid-row`
      // naturally starts at scrollTop 0, which previously reset the user's scroll position on
      // every reactive re-render (e.g. a checkbox toggle anywhere). May be undefined (no grid-row
      // currently mounted — e.g. first mount ever, or the current view is Month) — in which case
      // fall back to `pendingCalScrollTop`, captured by render() just before it wiped `this.el`
      // (and hence this viewContainer) out from under this call; see that field's own comment.
      const outgoingGridRow = viewContainer.querySelector<HTMLElement>('.tc-tg-grid-row');
      const preservedScrollTop = outgoingGridRow
        ? outgoingGridRow.scrollTop
        : this.pendingCalScrollTop;
      this.pendingCalScrollTop = undefined;

      this.calViewInstance?.destroy();
      viewContainer.empty();
      const firstDayOfWeek =
        this.settings.desktop.firstDayOfWeek ?? DEFAULT_VIEW_CONFIG.firstDayOfWeek;
      const cfg: ResolvedConfig = {
        ...DEFAULT_VIEW_CONFIG,
        ...this.settings.desktop,
        isMobile: false,
        sourceNoteDisplay: this.settings.sourceNoteDisplay,
        customFilePath: this.settings.customFilePath,
        startPosition: startPositionFor(this.calViewType, firstDayOfWeek),
      };
      // Scope the render to only the tasks anchored on a visible date, via the
      // O(1)-per-date TaskDateIndex, instead of scanning every task in the vault.
      const visibleDates = visibleCalendarDates(this.calViewType, this.calDate, cfg.firstDayOfWeek);
      const tasks = this.store.getTasksForDateRange(visibleDates);

      // Only scroll-to-now when this (viewType, date) pair is new since the last time we
      // scrolled — a reactive re-render of the same view/date (e.g. a store update from a task
      // edit) must not jump the scroll position back to center. See `lastScrolledCalKey` above.
      // Uses calDate directly (not cfg.startPosition/YYYY-ww) since Week's YYYY-ww format
      // collides across some year boundaries (e.g. 2015-01 matches both the week starting
      // 2014-12-28 and the one starting 2015-12-27), which would falsely suppress a re-scroll.
      const scrollKey = `${this.calViewType}:${this.calDate.format('YYYY-MM-DD')}`;
      const shouldScrollToNow = scrollKey !== this.lastScrolledCalKey;
      this.lastScrolledCalKey = scrollKey;

      if (this.calViewType === 'today') {
        this.calViewInstance = new TodayView({
          app: this.app,
          onTaskClick: handleTaskClick,
          onDrop: handleDrop,
          onDropTime: handleDropTime,
          onCreateAtTime: handleCreateAtTime,
          onCreateAtDate: handleCreateAtDateAllDay,
          onTimeChange: handleTimeChange,
          onDurationChange: handleDurationChange,
          onStartChange: handleStartChange,
          onDueChange: handleDueChange,
          onExtendToSpan: handleExtendToSpan,
          onToggle: (t) => {
            void this.store.toggleTask(t);
          },
          onSetStatus: (t, status) => {
            void this.store.setTaskStatus(t, status);
          },
          onSetPriority: (t, priority) => {
            void this.store.setPriority(t, priority);
          },
          statusRegistry: this.store.statusRegistry,
          tagGroups: this.settings.tagGroups,
        });
      } else if (this.calViewType === 'week') {
        this.calViewInstance = new WeekTimeGridView({
          app: this.app,
          onTaskClick: handleTaskClick,
          onDrop: handleDrop,
          onDropTime: handleDropTime,
          onCreateAtTime: handleCreateAtTime,
          onCreateAtDate: handleCreateAtDateAllDay,
          onDayHeaderClick: (date) => {
            this.calViewType = 'today';
            this.calDate = window.moment(date);
            this.render();
          },
          onTimeChange: handleTimeChange,
          onDurationChange: handleDurationChange,
          onStartChange: handleStartChange,
          onDueChange: handleDueChange,
          onExtendToSpan: handleExtendToSpan,
          onToggle: (t) => {
            void this.store.toggleTask(t);
          },
          onSetStatus: (t, status) => {
            void this.store.setTaskStatus(t, status);
          },
          onSetPriority: (t, priority) => {
            void this.store.setPriority(t, priority);
          },
          statusRegistry: this.store.statusRegistry,
          tagGroups: this.settings.tagGroups,
        });
      } else {
        this.calViewInstance = new MonthGridView({
          app: this.app,
          onDayClick: (date) => {
            this.calViewType = 'today';
            this.calDate = window.moment(date);
            this.render();
          },
          onCreateAtDate: handleCreateAtDate,
          onTaskClick: handleTaskClick,
          onDrop: handleDrop,
          onToggle: (t) => {
            void this.store.toggleTask(t);
          },
          onSetStatus: (t, status) => {
            void this.store.setTaskStatus(t, status);
          },
          onSetPriority: (t, priority) => {
            void this.store.setPriority(t, priority);
          },
          onWeekClick: (wk, yr) => {
            this.calViewType = 'week';
            this.calDate = window
              .moment()
              .isoWeekYear(parseInt(yr, 10))
              .isoWeek(parseInt(wk, 10))
              .startOf('isoWeek');
            this.render();
          },
          statusRegistry: this.store.statusRegistry,
          tagGroups: this.settings.tagGroups,
        });
      }
      this.calViewInstance.render(viewContainer, tasks, cfg, shouldScrollToNow, preservedScrollTop);
    };

    mountView();

    // Month/year/prev/next/today nav — unchanged from the existing implementation
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

    yearBtn.addEventListener('click', () => {
      const existing = this.el.querySelector('.tc-year-picker');
      if (existing) {
        existing.remove();
        return;
      }
      const picker = this.el.createDiv({ cls: 'tc-year-picker tc-popover' });
      const currentYear = this.calDate.year();
      for (let y = currentYear - 5; y <= currentYear + 5; y++) {
        const btn = picker.createEl('button', { cls: 'tc-year-picker-btn', text: String(y) });
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
      if (this.calViewType === 'week')
        this.calDate = this.calDate.clone().subtract(7, 'days').startOf('isoWeek');
      else if (this.calViewType === 'today') this.calDate = this.calDate.clone().subtract(1, 'day');
      else this.calDate = this.calDate.clone().subtract(1, 'months').date(1);
      updateTitle();
      mountView();
    });

    nextBtn.addEventListener('click', () => {
      if (this.calViewType === 'week')
        this.calDate = this.calDate.clone().add(7, 'days').startOf('isoWeek');
      else if (this.calViewType === 'today') this.calDate = this.calDate.clone().add(1, 'day');
      else this.calDate = this.calDate.clone().add(1, 'months').date(1);
      updateTitle();
      mountView();
    });

    todayBtn.addEventListener('click', () => {
      if (this.calViewType === 'week') this.calDate = window.moment().startOf('isoWeek');
      else if (this.calViewType === 'today') this.calDate = window.moment();
      else this.calDate = window.moment().date(1);
      updateTitle();
      mountView();
    });

    // NOTE — deliberate scope reduction vs. the spec's "targeted patch, not full re-mount":
    // this still calls the full mountView() (destroy + rebuild the visible grid) on every
    // coalesced notify, rather than diffing which specific cells/blocks changed and patching
    // only those. Two of the three perf levers from the spec ARE implemented in full: (1)
    // `tasks` above is scoped to the visible date range via TaskStore.getTasksForDateRange,
    // which is a union of O(1) TaskDateIndex lookups (Task 4) — mountView() no longer scans
    // every task in the vault on every render, only the ones anchored on a currently-visible
    // date; (2) notify() is coalesced (Task 5), so a burst of file edits triggers exactly one
    // rebuild instead of one per file. A true incremental DOM patch (diffing old vs. new task
    // sets per cell and touching only changed nodes) is a real further optimization but adds
    // significant complexity (diffing keyed by filePath+line across all three view shapes) for
    // a win that may not be measurable once (1) and (2) land — verified against the real dev
    // vault in Task 16. If a future pass shows visible lag with realistic task counts, add a
    // follow-up: track the previous render's task-list-per-visible-date, diff against the new
    // one on each notify, and only re-render cells/blocks whose task set changed, leaving
    // `BaseView.patch()` (still the default no-op-over-render from `BaseView.ts`) as the
    // extension point each of the three new view classes would override.
    this.calUnsubscribe = this.store.onUpdate(() => mountView());
  }

  private renderSearch(): void {
    const header = this.el.createDiv({ cls: 'tc-center-header' });
    header.createEl('h2', { cls: 'tc-center-title', text: 'Search' });
    const input = header.createEl('input', {
      cls: 'tc-center-search tc-search-global',
      attr: { type: 'text', placeholder: 'Search all tasks…', 'aria-label': 'Search all tasks' },
    });
    input.value = this.state.get('searchQuery');
    input.addEventListener('input', () => this.state.set('searchQuery', input.value));
    window.setTimeout(() => input.focus(), 0);

    const query = this.state.get('searchQuery').toLowerCase();
    if (!query) {
      const empty = this.el.createDiv({ cls: 'tc-center-scroll tc-search-empty' });
      empty.createEl('p', { cls: 'tc-empty-state', text: 'Type to search tasks…' });
      return;
    }

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

  private renderWithGrouping(container: HTMLElement, tasks: Task[]): void {
    const vs = this.state.get('centerListViewState');
    const today = window.moment().format('YYYY-MM-DD');
    const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');

    if (vs.groupBy === 'none') {
      this.renderFlat(container, tasks);
      return;
    }

    let groups: Array<{ label: string; tasks: Task[] }>;
    if (vs.groupBy === 'date') {
      groups = groupTasksByDate(tasks, today, tomorrow);
    } else if (vs.groupBy === 'priority') {
      groups = groupTasksByPriority(tasks);
    } else if (vs.groupBy === 'status') {
      groups = groupTasksByStatus(tasks, this.store.statusRegistry);
    } else {
      groups = groupTasksByTag(tasks);
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
    card.dataset['filePath'] = task.filePath;
    card.dataset['line'] = String(task.line);

    renderStatusMarker(card, {
      task,
      registry: this.store.statusRegistry,
      onLeftClick: () => void this.store.toggleTask(task),
      onContextMenu: (ev) => {
        ev.stopPropagation();
        showStatusMenuAt(ev, {
          task,
          registry: this.store.statusRegistry,
          onPickStatus: (c) => void this.store.setTaskStatus(task, c),
          onPickPriority: (p) => void this.store.setPriority(task, p),
        });
      },
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
    // Attached materials: link count precomputed by TaskStore (no per-render parsing).
    const linkCount = task.linkCount ?? 0;
    if (linkCount > 0) {
      const badge = titleRow.createEl('span', { cls: 'tc-task-count-badge' });
      setIcon(badge, 'paperclip');
      badge.createEl('span', { text: String(linkCount) });
    }

    const titleEl = titleRow.createEl('span', { cls: 'tc-task-title' });
    renderTaskText(titleEl, task.markdownText, {
      app: this.app,
      sourcePath: task.filePath,
      component: this.md,
      onEditLink: (occ, token) => this.editTaskLink(task, occ, token),
    });
    if (task.description) {
      const descEl = body.createDiv({ cls: 'tc-task-desc' });
      // Render the first description line as markdown so links are clickable here too.
      // No onEditLink: the card is a compact preview; link editing happens in the panel.
      renderTaskText(descEl, task.description.split('\n')[0] ?? '', {
        app: this.app,
        sourcePath: task.filePath,
        component: this.md,
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

      // Date + optional time: date part and time part are separately clickable
      if (d && !suppressToday) {
        const dateEl = metaRight.createEl('span', {
          cls: `tc-task-date ${this.getDateClass(d)}`.trim(),
        });
        // Date part: calendar icon + date text — click to filter by date
        const datePart = dateEl.createEl('span', { cls: 'tc-task-date-part tc-cursor-pointer' });
        const calIcon = datePart.createEl('span', { cls: 'tc-date-icon' });
        setIcon(calIcon, 'calendar');
        datePart.createEl('span', { text: this.formatDate(d) });
        datePart.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addPropertyFilter({ type: 'date', value: d });
        });
        // Time part: clock icon + time text — click to filter by time
        if (task.time) {
          const timePart = dateEl.createEl('span', { cls: 'tc-task-time-part tc-cursor-pointer' });
          const clockIcon = timePart.createEl('span', { cls: 'tc-date-icon' });
          setIcon(clockIcon, 'clock');
          timePart.createEl('span', { text: task.time });
          timePart.addEventListener('click', (e) => {
            e.stopPropagation();
            this.addPropertyFilter({ type: 'time', value: task.time! });
          });
        }
      } else if (!d && task.time) {
        const timeEl = metaRight.createEl('span', { cls: 'tc-task-date tc-cursor-pointer' });
        const clockIcon = timeEl.createEl('span', { cls: 'tc-date-icon' });
        setIcon(clockIcon, 'clock');
        timeEl.createEl('span', { text: task.time });
        timeEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addPropertyFilter({ type: 'time', value: task.time! });
        });
      }

      // Source note chip before tags
      if (showSourceNote) {
        renderSourceNoteChip(metaRight, task, (filePath) => {
          this.addPropertyFilter({ type: 'file', filePath });
        });
      }

      // Tags last (max 2, with group color)
      for (const tag of tags.slice(0, 2)) {
        const tagEl = metaRight.createEl('span', { cls: 'tc-task-tag', text: tag });
        const color = this.getTagColor(tag);
        if (color) {
          tagEl.setCssProps({ '--tc-tag-color': color });
          tagEl.addClass('tc-task-tag--colored');
        }
        tagEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addPropertyFilter({ type: 'tag', value: tag });
        });
        tagEl.addClass('tc-cursor-pointer');
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

    card.addEventListener('click', (e) => {
      const key = this.taskKey(task);

      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+Click: toggle this task in selection
        if (this.selectedTaskKeys.has(key)) {
          this.selectedTaskKeys.delete(key);
        } else {
          this.selectedTaskKeys.add(key);
          this.lastClickedTaskKey = key;
        }
        this.updateSelectionVisuals();
        return;
      }

      if (e.shiftKey && this.lastClickedTaskKey) {
        // Shift+Click: range select from anchor to this card
        const allCards = Array.from(this.el.querySelectorAll<HTMLElement>('.tc-task-card'));
        const keys = allCards.map(
          (c) => `${c.dataset['filePath'] ?? ''}:${c.dataset['line'] ?? ''}`,
        );
        const anchorIdx = keys.indexOf(this.lastClickedTaskKey);
        const thisIdx = keys.indexOf(key);
        if (anchorIdx !== -1) {
          const from = Math.min(anchorIdx, thisIdx);
          const to = Math.max(anchorIdx, thisIdx);
          for (let i = from; i <= to; i++) {
            const k = keys[i];
            if (k) this.selectedTaskKeys.add(k);
          }
          this.updateSelectionVisuals();
          return;
        }
      }

      // Plain click: clear selection, open in RightPanel
      this.selectedTaskKeys.clear();
      this.lastClickedTaskKey = key;
      this.updateSelectionVisuals();
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

    // Drop target for tag→task drag, and for project→task drag (drop a project
    // onto a task to move that task into the project note).
    card.addEventListener('dragover', (e) => {
      const project = this.state.get('draggingProject');
      const canDropProject = !!project && project !== task.filePath && !!this.projectManager;
      if (!this.state.get('draggingTag') && !canDropProject) return;
      e.preventDefault();
      card.classList.add('tc-drop-target');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('tc-drop-target');
    });
    card.addEventListener('drop', (e) => {
      card.classList.remove('tc-drop-target');
      const tag = this.state.get('draggingTag');
      const project = this.state.get('draggingProject');
      if (tag) {
        e.preventDefault();
        void this.tagManager.assignTagFromInbox(task, tag);
      } else if (project && project !== task.filePath && this.projectManager) {
        e.preventDefault();
        void this.projectManager.moveTaskToProject(task, project);
      }
    });

    // Right-click context menu
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const key = this.taskKey(task);

      // If right-clicking an unselected card while others are selected → clear and show single menu
      if (this.selectedTaskKeys.size > 0 && !this.selectedTaskKeys.has(key)) {
        this.selectedTaskKeys.clear();
        this.lastClickedTaskKey = null;
        this.updateSelectionVisuals();
      }

      // ── BULK MENU (2+ tasks selected) ─────────────────────
      if (this.selectedTaskKeys.size >= 2) {
        this.showBulkContextMenu(e, card);
        return;
      }

      // ── SINGLE TASK MENU ─────────────────────────────────
      const today = window.moment().format('YYYY-MM-DD');
      const isToday = task.due === today;
      const menu = new Menu();

      // ── Today toggle ──────────────────────────────────────
      menu.addItem((item) =>
        item
          .setTitle('Today')
          .setIcon('calendar')
          .setSection('today')
          .setChecked(isToday)
          .onClick(() => void this.toggleDueToday(task)),
      );

      // ── Pinned tags ────────────────────────────────────────
      if (this.settings.pinnedTags.length > 0) {
        for (const pinnedTag of this.settings.pinnedTags) {
          const hasTag = new RegExp(
            `${pinnedTag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\w/-])`,
            'u',
          ).test(task.rawText);
          menu.addItem((item) =>
            item
              .setTitle(pinnedTag)
              .setIcon('tag')
              .setSection('tags')
              .setChecked(hasTag)
              .onClick(() => void this.tagManager.toggleTagOnTask(task, pinnedTag)),
          );
        }
      }

      // ── Priority (submenu) ────────────────────────────────
      menu.addItem((item) => {
        item.setTitle('Priority').setIcon('arrow-up-narrow-wide').setSection('priority');
        const sub = getSubmenu(item);
        this.buildPrioritySubmenu(sub, task);
      });

      // ── Status (submenu) ──────────────────────────────────
      menu.addItem((item) => {
        item.setTitle('Status').setIcon('check-square').setSection('priority');
        const sub = getSubmenu(item);
        buildStatusSubmenu(
          sub,
          task,
          this.store.statusRegistry,
          (c) => void this.store.setTaskStatus(task, c),
        );
      });

      menu.addItem((item) =>
        item
          .setTitle('Filter by this priority')
          .setIcon('filter')
          .setSection('priority')
          .onClick(() => this.addPropertyFilter({ type: 'priority', value: task.priority })),
      );

      menu.addItem((item) =>
        item
          .setTitle('Filter by this status')
          .setIcon('filter')
          .setSection('priority')
          .onClick(() => this.addPropertyFilter({ type: 'status', value: task.statusSymbol })),
      );

      // ── Set tag… ───────────────────────────────────────────
      menu.addItem((item) =>
        item
          .setTitle('Set tag…')
          .setIcon('hash')
          .setSection('actions')
          .onClick(() => this.openTagPicker(task)),
      );

      // ── Open in note ──────────────────────────────────────
      menu.addItem((item) =>
        item
          .setTitle('Open in note')
          .setIcon('file-text')
          .setSection('actions')
          .onClick(() => void openInFile(this.app, task)),
      );

      // ── Delete ─────────────────────────────────────────────
      menu.addItem((item) =>
        item
          .setTitle('Delete')
          .setIcon('trash-2')
          .setSection('danger')
          .onClick(() => void this.deleteTask(task)),
      );

      menu.showAtMouseEvent(e);
    });
  }

  private bulkTagIndicator(count: number, total: number): string {
    if (count === total) return '✓ ';
    if (count > 0) return '~ ';
    return '';
  }

  private makeBulkTagRemoveHandler(selectedTasks: Task[], pinnedTag: string): () => void {
    return () =>
      void Promise.all(selectedTasks.map((t) => this.tagManager.toggleTagOnTask(t, pinnedTag)));
  }

  private makeBulkTagAddHandler(selectedTasks: Task[], pinnedTag: string): () => void {
    return () =>
      void Promise.all(selectedTasks.map((t) => this.tagManager.addTagToTask(t, pinnedTag)));
  }

  private addBulkTagItem(menu: Menu, pinnedTag: string, selectedTasks: Task[]): void {
    const escaped = pinnedTag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const tagRegex = new RegExp(`${escaped}(?![\\w/-])`, 'u');
    const count = selectedTasks.filter((t) => tagRegex.test(t.rawText)).length;
    const allHave = count === selectedTasks.length;
    const indicator = this.bulkTagIndicator(count, selectedTasks.length);
    const clickHandler = allHave
      ? this.makeBulkTagRemoveHandler(selectedTasks, pinnedTag)
      : this.makeBulkTagAddHandler(selectedTasks, pinnedTag);
    menu.addItem((item) =>
      item
        .setTitle(`${indicator}${pinnedTag}  (${count}/${selectedTasks.length})`)
        .setIcon('tag')
        .setSection('tags')
        .onClick(clickHandler),
    );
  }

  private async deleteBulkTasks(selectedTasks: Task[]): Promise<void> {
    const sorted = [...selectedTasks].sort((a, b) => b.line - a.line);
    for (const t of sorted) await this.deleteTask(t);
    this.selectedTaskKeys.clear();
    this.lastClickedTaskKey = null;
    this.updateSelectionVisuals();
  }

  private buildPrioritySubmenu(sub: Menu, task: Task): void {
    for (const level of PRIORITY_LEVELS) {
      sub.addItem((si) => {
        si.setTitle(level.label)
          .setIcon('flag')
          .setChecked(task.priority === level.value)
          .onClick(() => void this.setPriority(task, level.value));
        applyPriorityFlagColor(si, level.value);
      });
    }
  }

  private buildBulkPrioritySubmenu(sub: Menu, selectedTasks: Task[]): void {
    for (const level of PRIORITY_LEVELS) {
      sub.addItem((si) => {
        si.setTitle(level.label)
          .setIcon('flag')
          .onClick(
            () => void Promise.all(selectedTasks.map((t) => this.setPriority(t, level.value))),
          );
        applyPriorityFlagColor(si, level.value);
      });
    }
  }

  private getTaskTags(task: Task): Set<string> {
    return new Set(task.rawText.match(/#[\w/][\w/-]*/gu) ?? []);
  }

  private openTagPicker(task: Task): void {
    const currentTags = this.getTaskTags(task);
    const handleCommit = (toAdd: string[], toRemove: string[]): void => {
      for (const tag of toAdd) void this.tagManager.addTagToTask(task, tag);
      for (const tag of toRemove) void this.tagManager.removeTagFromTask(task, tag);
    };
    new TagPickerModal(
      this.app,
      (tag) => this.getTagColor(tag),
      currentTags,
      new Set(),
      handleCommit,
    ).open();
  }

  private openBulkTagPicker(selectedTasks: Task[]): void {
    const tagSets = selectedTasks.map((t) => this.getTaskTags(t));
    const allTags = new Set(tagSets.flatMap((s) => [...s]));
    const hasAll = (tag: string): boolean => tagSets.every((s) => s.has(tag));
    const currentTags = new Set([...allTags].filter(hasAll));
    const partialTags = new Set([...allTags].filter((tag) => !hasAll(tag)));
    const handleBulkCommit = (toAdd: string[], toRemove: string[]): void => {
      for (const tag of toAdd)
        void Promise.all(selectedTasks.map((t) => this.tagManager.addTagToTask(t, tag)));
      for (const tag of toRemove)
        void Promise.all(selectedTasks.map((t) => this.tagManager.removeTagFromTask(t, tag)));
    };
    new TagPickerModal(
      this.app,
      (tag) => this.getTagColor(tag),
      currentTags,
      partialTags,
      handleBulkCommit,
    ).open();
  }

  private showBulkContextMenu(e: MouseEvent, _card: HTMLElement): void {
    const selectedKeys = Array.from(this.selectedTaskKeys);
    const allTasks = this.store.getTasks();
    const selectedTasks = selectedKeys
      .map((k) => {
        const lastColon = k.lastIndexOf(':');
        const fp = k.slice(0, lastColon);
        const lineNum = parseInt(k.slice(lastColon + 1), 10);
        return allTasks.find((t) => t.filePath === fp && t.line === lineNum);
      })
      .filter((t): t is Task => t !== undefined);

    const menu = new Menu();
    const today = window.moment().format('YYYY-MM-DD');
    const allHaveToday = selectedTasks.every((t) => t.due === today);

    // Header (non-interactive label)
    menu.addItem((item) =>
      item
        .setTitle(`${selectedTasks.length} tasks selected`)
        .setSection('header')
        .setDisabled(true),
    );

    // Today toggle
    menu.addItem((item) =>
      item
        .setTitle(allHaveToday ? '✓ Today (remove all)' : 'Set Today')
        .setIcon('calendar')
        .setSection('today')
        .onClick(() => void Promise.all(selectedTasks.map((t) => this.toggleDueToday(t)))),
    );

    // Pinned tags
    for (const pinnedTag of this.settings.pinnedTags) {
      this.addBulkTagItem(menu, pinnedTag, selectedTasks);
    }

    // Priority (submenu)
    menu.addItem((item) => {
      item.setTitle('Priority').setIcon('arrow-up-narrow-wide').setSection('priority');
      const sub = getSubmenu(item);
      this.buildBulkPrioritySubmenu(sub, selectedTasks);
    });

    // Status (submenu) — applies to all selected tasks
    menu.addItem((item) => {
      item.setTitle('Status').setIcon('check-square').setSection('priority');
      const sub = getSubmenu(item);
      buildStatusSubmenu(sub, selectedTasks[0]!, this.store.statusRegistry, (c) => {
        void Promise.all(selectedTasks.map((t) => this.store.setTaskStatus(t, c)));
      });
    });

    // Set tag…
    menu.addItem((item) =>
      item
        .setTitle('Set tag…')
        .setIcon('hash')
        .setSection('actions')
        .onClick(() => this.openBulkTagPicker(selectedTasks)),
    );

    // Delete all
    menu.addItem((item) =>
      item
        .setTitle('Delete all')
        .setIcon('trash-2')
        .setSection('danger')
        .onClick(() => void this.deleteBulkTasks(selectedTasks)),
    );

    menu.showAtMouseEvent(e);
  }

  private renderPropertyChips(container: HTMLElement): void {
    const vs = this.state.get('centerListViewState');
    for (let i = 0; i < vs.filters.length; i++) {
      const f = vs.filters[i]!;
      const label = this.filterChipLabel(f);
      const chip = container.createEl('span', { cls: 'tc-filter-chip' });
      chip.createEl('span', { cls: 'tc-filter-chip-label', text: label });
      const x = chip.createEl('button', { cls: 'tc-filter-chip-x', text: '×' });
      const idx = i;
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removePropertyFilter(idx);
      });
    }
  }

  private filterChipLabel(f: PropertyFilter): string {
    if (f.type === 'tag') return f.value;
    if (f.type === 'file') return `📄 ${f.filePath.split('/').pop()?.replace(/\.md$/, '') ?? ''}`;
    if (f.type === 'time') return `⏰ ${f.value}`;
    if (f.type === 'status') return this.store.statusRegistry.bySymbol(f.value)?.name ?? f.value;
    if (f.type === 'date') return `📅 ${this.formatDate(f.value)}`;
    const level = PRIORITY_LEVELS.find((l) => l.value === f.value);
    if (!level) return f.value;
    // D/None has no emoji and reads as "Normal" here (distinct from the
    // "None" label used in priority-picker menus).
    return level.emoji ? `${level.emoji} ${level.label}` : 'Normal';
  }

  private addPropertyFilter(filter: PropertyFilter): void {
    const vs = this.state.get('centerListViewState');
    const already = vs.filters.some((f) => {
      if (f.type !== filter.type) return false;
      if (f.type === 'file' && filter.type === 'file') return f.filePath === filter.filePath;
      if (f.type === 'tag' && filter.type === 'tag') return f.value === filter.value;
      if (f.type === 'time' && filter.type === 'time') return f.value === filter.value;
      if (f.type === 'priority' && filter.type === 'priority') return f.value === filter.value;
      if (f.type === 'status' && filter.type === 'status') return f.value === filter.value;
      if (f.type === 'date' && filter.type === 'date') return f.value === filter.value;
      return false;
    });
    if (already) return;
    const next: ListViewState = { ...vs, filters: [...vs.filters, filter] };
    this.updateViewState(next);
  }

  private removePropertyFilter(idx: number): void {
    const vs = this.state.get('centerListViewState');
    const next: ListViewState = { ...vs, filters: vs.filters.filter((_, i) => i !== idx) };
    this.updateViewState(next);
  }

  private updateViewState(next: ListViewState): void {
    if (!this.settings.listViewStates) this.settings.listViewStates = {};
    this.settings.listViewStates[this.currentListKey] = next;
    void this.onSaveSettings();
    this.state.set('centerListViewState', next);
  }

  private renderViewStateButton(container: HTMLElement): void {
    const vs = this.state.get('centerListViewState');
    const defaults = getListViewDefaults(this.currentListKey);
    const isNonDefault =
      vs.groupBy !== defaults.groupBy ||
      vs.sortBy.field !== defaults.sortBy.field ||
      vs.sortBy.dir !== defaults.sortBy.dir ||
      !statusGroupsEqual(vs.statusGroups, defaults.statusGroups);

    const btn = container.createEl('button', {
      cls: `tc-view-state-btn${isNonDefault ? ' tc-view-state-btn--active' : ''}`,
      attr: { 'aria-label': 'Sort & group options' },
    });
    setIcon(btn, 'arrow-up-down');
    btn.addEventListener('click', () => this.showViewStatePopover(btn));

    if (this.reopenStatusGroupPopover) {
      this.reopenStatusGroupPopover = false;
      this.showViewStatePopover(btn, true);
    }
  }

  private showViewStatePopover(anchor: HTMLElement, autoOpenStatusGroupRow = false): void {
    const existing = this.el.querySelector('.tc-view-state-popover');
    if (existing) {
      existing.remove();
      return;
    }

    const vs = this.state.get('centerListViewState');
    const popover = this.el.createDiv({ cls: 'tc-view-state-popover tc-popover' });

    let dismiss: (e: MouseEvent) => void;
    dismiss = (e: MouseEvent): void => {
      if (!popover.contains(e.target as Node) && e.target !== anchor) {
        popover.remove();
        activeDocument.removeEventListener('click', dismiss, true);
      }
    };

    const makeRow = (
      icon: string,
      label: string,
      displayValue: string,
      activeValue: string,
      defaultValue: string,
      options: Array<{ label: string; value: string }>,
      onSelect: (value: string) => void,
    ): void => {
      const row = popover.createDiv({ cls: 'tc-view-state-row' });
      const rowMain = row.createDiv({ cls: 'tc-view-state-row-main' });
      const iconEl = rowMain.createEl('span', { cls: 'tc-view-state-row-icon' });
      setIcon(iconEl, icon);
      rowMain.createEl('span', { cls: 'tc-view-state-row-label', text: label });
      rowMain.createEl('span', { cls: 'tc-view-state-row-value', text: displayValue });
      const chevEl = rowMain.createEl('span', { cls: 'tc-view-state-row-chevron' });
      setIcon(chevEl, 'chevron-right');

      const subList = row.createDiv({ cls: 'tc-view-state-sublist tc-hidden' });

      rowMain.addEventListener('click', () => {
        const isOpen = !subList.hasClass('tc-hidden');
        popover.querySelectorAll<HTMLElement>('.tc-view-state-sublist').forEach((el) => {
          el.addClass('tc-hidden');
        });
        popover.querySelectorAll<HTMLElement>('.tc-view-state-row-main').forEach((el) => {
          el.removeClass('is-open');
        });
        if (!isOpen) {
          subList.removeClass('tc-hidden');
          rowMain.addClass('is-open');
        }
      });

      for (const opt of options) {
        const isActive = opt.value === activeValue;
        const isDefault = opt.value === defaultValue;
        const optEl = subList.createEl('button', { cls: 'tc-view-state-option' });
        const checkEl = optEl.createEl('span', { cls: 'tc-view-state-option-check' });
        if (isActive) setIcon(checkEl, 'check');
        optEl.createEl('span', { cls: 'tc-view-state-option-label', text: opt.label });
        if (isDefault) {
          optEl.createEl('span', { cls: 'tc-view-state-option-default', text: 'Default' });
        }
        optEl.addEventListener('click', () => {
          onSelect(opt.value);
          popover.remove();
          activeDocument.removeEventListener('click', dismiss, true);
        });
      }
    };

    // Like makeRow, but options toggle membership in a set rather than
    // selecting a single value, and the popover stays open after a click
    // so multiple options can be picked. `presets`, if given, render as
    // plain (non-checkable) shortcut buttons above a divider, ahead of the
    // toggle options — they just set the whole selection in one click.
    const makeMultiRow = (
      icon: string,
      label: string,
      displayValue: string,
      selected: readonly string[],
      options: Array<{ label: string; value: string }>,
      onToggle: (value: string) => void,
      initiallyOpen = false,
      presets: Array<{ label: string; onClick: () => void; isActive?: boolean }> = [],
    ): void => {
      const row = popover.createDiv({ cls: 'tc-view-state-row' });
      const rowMain = row.createDiv({ cls: 'tc-view-state-row-main' });
      const iconEl = rowMain.createEl('span', { cls: 'tc-view-state-row-icon' });
      setIcon(iconEl, icon);
      rowMain.createEl('span', { cls: 'tc-view-state-row-label', text: label });
      rowMain.createEl('span', { cls: 'tc-view-state-row-value', text: displayValue });
      const chevEl = rowMain.createEl('span', { cls: 'tc-view-state-row-chevron' });
      setIcon(chevEl, 'chevron-right');

      const subList = row.createDiv({ cls: 'tc-view-state-sublist tc-hidden' });
      if (initiallyOpen) {
        subList.removeClass('tc-hidden');
        rowMain.addClass('is-open');
      }

      rowMain.addEventListener('click', () => {
        const isOpen = !subList.hasClass('tc-hidden');
        popover.querySelectorAll<HTMLElement>('.tc-view-state-sublist').forEach((el) => {
          el.addClass('tc-hidden');
        });
        popover.querySelectorAll<HTMLElement>('.tc-view-state-row-main').forEach((el) => {
          el.removeClass('is-open');
        });
        if (!isOpen) {
          subList.removeClass('tc-hidden');
          rowMain.addClass('is-open');
        }
      });

      for (const preset of presets) {
        const optEl = subList.createEl('button', { cls: 'tc-view-state-option' });
        const checkEl = optEl.createEl('span', { cls: 'tc-view-state-option-check' });
        if (preset.isActive) setIcon(checkEl, 'check');
        optEl.createEl('span', { cls: 'tc-view-state-option-label', text: preset.label });
        optEl.addEventListener('click', () => preset.onClick());
      }
      if (presets.length > 0) {
        subList.createDiv({ cls: 'tc-view-state-sublist-divider' });
      }

      for (const opt of options) {
        const isActive = selected.includes(opt.value);
        const optEl = subList.createEl('button', { cls: 'tc-view-state-option' });
        const checkEl = optEl.createEl('span', { cls: 'tc-view-state-option-check' });
        if (isActive) setIcon(checkEl, 'check');
        optEl.createEl('span', { cls: 'tc-view-state-option-label', text: opt.label });
        optEl.addEventListener('click', () => {
          onToggle(opt.value);
        });
      }
    };

    const GROUP_BY_OPTIONS = [
      { label: 'None', value: 'none' },
      { label: 'Date', value: 'date' },
      { label: 'Priority', value: 'priority' },
      { label: 'Tag', value: 'tag' },
      { label: 'Status', value: 'status' },
    ];
    const GROUP_LABELS: Record<string, string> = {
      none: 'None',
      date: 'Date',
      priority: 'Priority',
      tag: 'Tag',
      status: 'Status',
    };

    const sortDirArrow = vs.sortBy.dir === 'asc' ? '↑' : '↓';
    const sortFieldArrow = (field: string): string =>
      vs.sortBy.field === field ? sortDirArrow : '';
    const SORT_BY_OPTIONS = [
      { label: `Date ${sortFieldArrow('date')}`.trim(), value: 'date' },
      { label: `Priority ${sortFieldArrow('priority')}`.trim(), value: 'priority' },
      { label: `Title ${sortFieldArrow('title')}`.trim(), value: 'title' },
      { label: `Tag ${sortFieldArrow('tag')}`.trim(), value: 'tag' },
      { label: `Status ${sortFieldArrow('status')}`.trim(), value: 'status' },
    ];
    const sortLabel = `${vs.sortBy.field.charAt(0).toUpperCase() + vs.sortBy.field.slice(1)} ${vs.sortBy.dir === 'asc' ? '↑' : '↓'}`;

    const STATUS_GROUP_OPTIONS: Array<{ label: string; value: TaskStatusType }> =
      ALL_STATUS_GROUPS.map((value) => ({ label: TYPE_LABELS[value], value }));

    // Unified "Show" display value: All (undefined/all 4), Active (exactly
    // the open+in-progress pair), otherwise a count of the selected groups.
    const showDisplayValue = (selected: TaskStatusType[] | undefined): string => {
      const effective = normalizeStatusGroups(selected) ?? ALL_STATUS_GROUPS;
      if (effective.length >= 4) return 'All';
      if (statusGroupsEqual(effective, ACTIVE_STATUS_GROUPS)) return 'Active';
      return `${effective.length} selected`;
    };

    const defaults = getListViewDefaults(this.currentListKey);

    makeRow(
      'layout-list',
      'Group by',
      GROUP_LABELS[vs.groupBy] ?? vs.groupBy,
      vs.groupBy,
      defaults.groupBy,
      GROUP_BY_OPTIONS,
      (val) => {
        this.updateViewState({ ...vs, groupBy: val as ListViewState['groupBy'] });
      },
    );

    makeRow(
      'arrow-up-down',
      'Sort by',
      sortLabel,
      vs.sortBy.field,
      defaults.sortBy.field,
      SORT_BY_OPTIONS,
      (val) => {
        const field = val as ListViewState['sortBy']['field'];
        const dir: 'asc' | 'desc' =
          vs.sortBy.field === field && vs.sortBy.dir === 'asc' ? 'desc' : 'asc';
        this.updateViewState({ ...vs, sortBy: { field, dir } });
      },
    );

    // Single unified "Show" control — replaces the old separate Show
    // single-select and Status group multi-select, which contradicted each
    // other. "Active"/"All" are one-click presets; the 4 toggles below them
    // are the actual source of truth (presets just set their state).
    const applyStatusGroupsChange = (nextStatusGroups: TaskStatusType[] | undefined): void => {
      this.reopenStatusGroupPopover = true;
      // The popover is about to be torn down and rebuilt by the full re-render
      // that updateViewState triggers — drop this instance's dismiss listener
      // now so it doesn't linger on a detached node.
      activeDocument.removeEventListener('click', dismiss, true);
      this.updateViewState({ ...vs, statusGroups: nextStatusGroups });
    };

    makeMultiRow(
      'eye',
      'Show',
      showDisplayValue(vs.statusGroups),
      vs.statusGroups ?? ALL_STATUS_GROUPS,
      STATUS_GROUP_OPTIONS,
      (val) => {
        const value = val as TaskStatusType;
        const current = vs.statusGroups ?? ALL_STATUS_GROUPS;
        const next = current.includes(value)
          ? current.filter((g) => g !== value)
          : [...current, value];
        // All 4 selected (or none, treated the same as "all") is the default — store
        // undefined so the state stays clean and matches getListViewDefaults.
        const nextStatusGroups = next.length === 0 || next.length >= 4 ? undefined : next;
        applyStatusGroupsChange(nextStatusGroups);
      },
      autoOpenStatusGroupRow,
      [
        {
          label: 'Active',
          onClick: () => applyStatusGroupsChange(ACTIVE_STATUS_GROUPS),
          isActive: statusGroupsEqual(vs.statusGroups, ACTIVE_STATUS_GROUPS),
        },
        {
          label: 'All',
          onClick: () => applyStatusGroupsChange(undefined),
          isActive: normalizeStatusGroups(vs.statusGroups) === undefined,
        },
      ],
    );

    // Reset to defaults row — only shown when state differs from defaults.
    // Same predicate as the left-panel customization dot.
    if (isListViewCustomized(vs, this.currentListKey)) {
      const resetRow = popover.createDiv({ cls: 'tc-view-state-reset' });
      const resetBtn = resetRow.createEl('button', {
        cls: 'tc-view-state-reset-btn',
        text: 'Reset to defaults',
      });
      resetBtn.addEventListener('click', () => {
        this.updateViewState(getListViewDefaults(this.currentListKey));
        popover.remove();
        activeDocument.removeEventListener('click', dismiss, true);
      });
    }

    anchor.after(popover);
    window.setTimeout(() => {
      activeDocument.addEventListener('click', dismiss, true);
    }, 0);
  }

  /**
   * Click-to-create quick-add for the hour grid (Today/Week): an inline input positioned
   * absolutely inside `hourColumnEl`, at the same `top` a timed block for `time` would use
   * (mirrors renderTimedBlocksForDay's own `block.style.top` positioning — the technique Task 1
   * fixed for the month/year pickers: an absolutely-positioned child anchored via inline
   * top/left inside a `position: relative`/`position: absolute` container, not one that shoves
   * surrounding layout). On Enter, appends `⏰ {time}` to the text and writes via store.addTask.
   */
  private showTimeGridQuickAdd(
    hourColumnEl: HTMLElement,
    date: string,
    time: string,
    onDone: () => void,
  ): void {
    hourColumnEl.querySelectorAll('.tc-tg-quick-add').forEach((el) => el.remove());
    const pop = hourColumnEl.createDiv({ cls: 'tc-tg-quick-add' });
    pop.style.top = `${minutesToPixels(timeStringToMinutes(time))}px`;
    const input = pop.createEl('input', {
      cls: 'tc-tg-quick-add-input',
      attr: { type: 'text', placeholder: `Task at ${time}…` },
    });

    let committed = false;
    const commit = (): void => {
      if (committed) return;
      committed = true;
      const text = input.value.trim();
      pop.remove();
      if (text) void this.store.addTask(date, `${text} ⏰ ${time}`).then(() => onDone());
    };
    const cancel = (): void => {
      committed = true;
      pop.remove();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (activeDocument.activeElement !== input) commit();
      }, 150);
    });
    window.setTimeout(() => input.focus(), 0);
  }

  /**
   * Click-to-create quick-add that fills a cell (`inset: 2px`-style, matching the cell's own
   * padding, so it never gets clipped by the cell's `overflow: hidden`) — same
   * anchored-absolute-child-of-a-positioned-container technique as showTimeGridQuickAdd/Task 1's
   * month-year picker fix, just sized to the cell instead of offset below it. Shared by Month's
   * day-cell "+" button and the all-day/"no-time" row's empty-space click-to-create (Task 18) —
   * both just need a plain (untimed) task name typed against a given date, so only the CSS class
   * (for each cell shape's own styling) varies between callers.
   */
  private showFillCellQuickAdd(
    cell: HTMLElement,
    date: string,
    popCls: string,
    onDone: () => void,
  ): void {
    cell.querySelectorAll(`.${popCls}`).forEach((el) => el.remove());
    const pop = cell.createDiv({ cls: popCls });
    const input = pop.createEl('input', {
      cls: `${popCls}-input`,
      attr: { type: 'text', placeholder: 'Task name…' },
    });

    let committed = false;
    const commit = (): void => {
      if (committed) return;
      committed = true;
      const text = input.value.trim();
      pop.remove();
      if (text) void this.store.addTask(date, text).then(() => onDone());
    };
    const cancel = (): void => {
      committed = true;
      pop.remove();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (activeDocument.activeElement !== input) commit();
      }, 150);
    });
    window.setTimeout(() => input.focus(), 0);
  }

  private renderAddTaskBar(): void {
    const bar = this.el.createDiv({ cls: 'tc-add-task-bar' });
    const trigger = bar.createDiv({ cls: 'tc-add-task-trigger' });
    trigger.createEl('span', { cls: 'tc-add-task-plus', text: '+' });
    trigger.createEl('span', { cls: 'tc-add-task-label', text: 'Add task' });
    bar.addEventListener('click', () => {
      if (bar.querySelector('.tc-quick-capture')) return;
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

  /** Append a task line into a specific note, honoring the section-insertion
   *  setting. Callers pass the mode/section to use (global for most notes, the
   *  project-specific one for project notes). */
  private async appendTaskToNote(
    file: TFile,
    line: string,
    mode: 'append' | 'section' = this.settings.taskInsertionMode,
    section: string = this.settings.taskInsertionSection,
  ): Promise<void> {
    await this.app.vault.process(file, (content) =>
      insertTaskBlockIntoContent(content, line, mode, section),
    );
  }

  private async createTask(text: string): Promise<void> {
    const sel = this.state.get('selectedList');
    const today = window.moment().format('YYYY-MM-DD');

    // Today view: delegate fully to store (resolver handles file + prefix + date)
    if (sel === 'today' || sel === 'upcoming') {
      await this.store.addTask(today, text);
      return;
    }

    // Project context: write the task directly into the project note, using the
    // project-specific insertion setting.
    if (typeof sel === 'object' && sel.type === 'project') {
      const file = this.app.vault.getAbstractFileByPath(sel.path);
      if (file instanceof TFile) {
        const { taskInsertionMode: mode, taskInsertionSection: section } = this.settings.projects;
        await this.appendTaskToNote(file, `- [ ] ${text}`, mode, section);
      }
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
    const rangeEnd = task.subtaskRange ? task.subtaskRange.to : task.line;
    await this.mutations.deleteTaskBlock(locatorOf(task), rangeEnd);
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
    const vs = this.state.get('centerListViewState');
    const filter = this.state.get('centerFilter').toLowerCase();
    const today = window.moment().format('YYYY-MM-DD');

    // 1. List selection filter
    let tasks: Task[];
    if (typeof sel === 'string') {
      switch (sel) {
        case 'inbox':
          tasks = this.getInboxTasks();
          break;
        case 'today': {
          const todayStr = window.moment().format('YYYY-MM-DD');
          tasks = this.store.getTasks().filter((t) => {
            if (t.due === todayStr || t.scheduled === todayStr || t.dailyNoteDate === todayStr)
              return true;
            if (t.due && t.due < todayStr) return true;
            return false;
          });
          break;
        }
        case 'upcoming': {
          tasks = this.store.getTasks().filter((t) => {
            const d = t.due ?? t.scheduled ?? t.dailyNoteDate;
            return d !== undefined && d > today;
          });
          break;
        }
        default:
          tasks = this.store.getTasks();
      }
    } else if (sel.type === 'tag') {
      tasks = this.store.getTasks({ tag: sel.tag });
    } else if (sel.type === 'project') {
      tasks = this.store.getTasks().filter((t) => t.filePath === sel.path);
    } else {
      const group = this.settings.tagGroups.find((g) => g.id === sel.groupId);
      tasks = this.store.getTasks().filter((t) => {
        if (!group) return false;
        if (group.mode === 'prefix' && group.prefix) return t.rawText.includes(`#${group.prefix}`);
        return (group.tags ?? []).some((tag) => t.rawText.includes(tag));
      });
    }

    // 2. Show status filter (undefined/all-4 statusGroups → no filter)
    tasks = filterTasksByStatusGroups(tasks, vs.statusGroups, this.store.statusRegistry);

    // 3. Property filters (AND)
    for (const f of vs.filters) {
      if (f.type === 'tag') {
        const escaped = f.value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const re = new RegExp(`${escaped}(?![\\w/-])`, 'u');
        tasks = tasks.filter((t) => re.test(t.rawText));
      } else if (f.type === 'file') {
        tasks = tasks.filter((t) => t.filePath === f.filePath);
      } else if (f.type === 'time') {
        tasks = tasks.filter((t) => t.time === f.value);
      } else if (f.type === 'priority') {
        tasks = tasks.filter((t) => t.priority === f.value);
      } else if (f.type === 'status') {
        tasks = tasks.filter((t) => t.statusSymbol === f.value);
      } else if (f.type === 'date') {
        tasks = tasks.filter((t) => (t.due ?? t.scheduled ?? t.dailyNoteDate) === f.value);
      }
    }

    // 4. Text filter
    if (filter) {
      tasks = tasks.filter(
        (t) => t.text.toLowerCase().includes(filter) || t.rawText.toLowerCase().includes(filter),
      );
    }

    // 5. Sort
    return sortTasksByField(tasks, vs.sortBy.field, vs.sortBy.dir, this.store.statusRegistry);
  }

  private getInboxTasks(): Task[] {
    const { inbox } = this.settings;
    const all = this.store.getTasks();
    const withTag =
      inbox.mode !== 'untagged' ? all.filter((t) => t.rawText.includes(inbox.tag)) : [];
    const includeUntagged = inbox.mode !== 'tag';
    const untagged = includeUntagged ? all.filter((t) => !/#[\w/-]+/u.test(t.rawText)) : [];
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
    if (typeof sel === 'object' && sel.type === 'project') return projectNameFromPath(sel.path);
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

    await this.mutations.applyValidatedLineMutation(locatorOf(task), (tl) => {
      let updated: string;
      if (task.scheduled) {
        updated = tl.replace(/⏳\s*\d{4}-\d{2}-\d{2}/u, `⏳ ${targetDate}`);
      } else if (task.due) {
        updated = tl.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${targetDate}`);
      } else {
        updated = tl.trimEnd() + ` 📅 ${targetDate}`;
      }
      // Task 26: this same generic onDrop path now also receives drops of previously-timed
      // hour-grid blocks onto the all-day/"No-time" row (see renderTimedBlocks.ts's new
      // draggable="true" + dragstart). Landing on the all-day row means "no longer timed" —
      // the inverse of Round 2 Task 8's setTaskTimeFromDrop — so strip ⏰/⏱️ here rather than
      // leaving a stale time on a task that now renders as an all-day item.
      if (task.time) {
        updated = updated
          .replace(/⏰\s*\d{1,2}:\d{2}/u, '')
          .replace(/⏱️\s*(?:\d+h)?(?:\d+m)?/u, '')
          .replace(/\s{2,}/gu, ' ')
          .trimEnd();
      }
      return formatTaskLine(updated);
    });
  }

  private async setTaskTimeFromDrop(dragData: string, date: string, time: string): Promise<void> {
    const parts = dragData.split(':::');
    if (parts.length < 2) return;
    const [filePath, lineStr] = parts;
    const line = parseInt(lineStr ?? '0', 10);
    if (!filePath || isNaN(line)) return;

    const task = this.store.getTasks().find((t) => t.filePath === filePath && t.line === line);
    if (!task) return;

    await this.mutations.applyValidatedLineMutation(locatorOf(task), (tl) => {
      let updated: string;
      if (task.scheduled) {
        updated = tl.replace(/⏳\s*\d{4}-\d{2}-\d{2}/u, `⏳ ${date}`);
      } else if (task.due) {
        updated = tl.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${date}`);
      } else {
        updated = tl.trimEnd() + ` 📅 ${date}`;
      }
      updated = task.time
        ? updated.replace(/⏰\s*\d{1,2}:\d{2}/u, `⏰ ${time}`)
        : updated.trimEnd() + ` ⏰ ${time}`;
      return formatTaskLine(updated);
    });
  }

  private async updateTaskTime(task: Task, newStartMinutes: number): Promise<void> {
    const newTime = minutesToTimeString(newStartMinutes);
    await this.mutations.applyValidatedLineMutation(locatorOf(task), (line) => {
      const withTime = task.time
        ? line.replace(/⏰\s*\d{1,2}:\d{2}/u, `⏰ ${newTime}`)
        : line.trimEnd() + ` ⏰ ${newTime}`;
      return formatTaskLine(withTime);
    });
  }

  private async updateTaskDuration(task: Task, newDurationMinutes: number): Promise<void> {
    const token = `⏱️ ${formatDurationFromMinutes(newDurationMinutes)}`;
    await this.mutations.applyValidatedLineMutation(locatorOf(task), (line) => {
      const withDuration = task.duration
        ? line.replace(/⏱️\s*(?:\d+h)?(?:\d+m)?/u, token)
        : line.trimEnd() + ` ${token}`;
      return formatTaskLine(withDuration);
    });
  }

  private async updateTaskStart(task: Task, newStart: string): Promise<void> {
    await this.mutations.applyValidatedLineMutation(locatorOf(task), (line) => {
      const withStart = task.start
        ? line.replace(/🛫\s*\d{4}-\d{2}-\d{2}/u, `🛫 ${newStart}`)
        : line.trimEnd() + ` 🛫 ${newStart}`;
      return formatTaskLine(withStart);
    });
  }

  private async rescheduleTaskDue(task: Task, newDue: string): Promise<void> {
    await this.mutations.applyValidatedLineMutation(locatorOf(task), (line) => {
      const withDue = task.due
        ? line.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${newDue}`)
        : line.trimEnd() + ` 📅 ${newDue}`;
      return formatTaskLine(withDue);
    });
  }

  // A plain task has no `start` yet, so extending it into a span needs both ends
  // written in one mutation: the original `due` is frozen as the new `start`, and
  // `due` moves to the dragged-to date.
  private async extendTaskToSpan(task: Task, newDue: string): Promise<void> {
    if (!task.due) return;
    const originalDue = task.due;
    await this.mutations.applyValidatedLineMutation(locatorOf(task), (line) => {
      // A task that already spans (has a start) is being re-extended, not extended for the
      // first time — only append a fresh 🛫 when one isn't already present, so re-dragging an
      // already-spanning block's anchor never appends a second, extraneous 🛫 token.
      const withStart = task.start ? line : line.trimEnd() + ` 🛫 ${originalDue}`;
      const withDue = withStart.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${newDue}`);
      return formatTaskLine(withDue);
    });
  }

  private editTaskLink(task: Task, occ: number, token: LinkToken): void {
    new LinkEditModal(
      this.app,
      token,
      (newRaw) => {
        void rewriteLinkInTask(this.mutations, task, occ, newRaw);
      },
      task.filePath,
    ).open();
  }

  private async toggleDueToday(task: Task): Promise<void> {
    const today = window.moment().format('YYYY-MM-DD');
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      let updated: string;
      if (task.due === today) {
        updated = line
          .replace(/📅\s*\d{4}-\d{2}-\d{2}/u, '')
          .replace(/\s{2,}/gu, ' ')
          .trimEnd();
      } else if (task.due) {
        updated = line.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${today}`);
      } else {
        updated = line.trimEnd() + ` 📅 ${today}`;
      }
      lines[taskLine] = updated;
    });
  }

  private taskKey(task: Task): string {
    return `${task.filePath}:${task.line}`;
  }

  private updateSelectionVisuals(): void {
    // Sync tc-multi-selected class on each card
    this.el.querySelectorAll<HTMLElement>('.tc-task-card').forEach((card) => {
      const key = `${card.dataset['filePath'] ?? ''}:${card.dataset['line'] ?? ''}`;
      card.classList.toggle('tc-multi-selected', this.selectedTaskKeys.has(key));
    });

    // Update or remove badge
    const existing = this.el.querySelector('.tc-selection-badge');
    if (this.selectedTaskKeys.size >= 2) {
      if (existing) {
        existing.textContent = `${this.selectedTaskKeys.size} selected`;
      } else {
        const list = this.el.querySelector('.tc-center-scroll');
        if (list) {
          const badge = list.createDiv({ cls: 'tc-selection-badge' });
          badge.textContent = `${this.selectedTaskKeys.size} selected`;
          list.prepend(badge);
        }
      }
    } else {
      existing?.remove();
    }
  }

  private async setPriority(
    task: Task,
    priority: 'A' | 'B' | 'C' | 'D' | 'E' | 'F',
  ): Promise<void> {
    await this.store.setPriority(task, priority);
  }
}
