# Visual Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Исправить 13 визуальных и функциональных багов плагина Task Calendar.

**Architecture:** Изменения разбиты на 5 параллельно независимых задач по компонентам: CenterPanel task-list, CenterPanel calendar, RightPanel, LeftPanel+Modal+CSS.

**Tech Stack:** TypeScript, Obsidian Plugin API, vanilla DOM, moment.js.

## Global Constraints

- `activeDocument` вместо `document` (obsidian lint rule).
- DOM через Obsidian helpers: `createDiv()`, `createEl()`.
- Запись в файлы только через `app.vault.process()`.
- Strict TypeScript: нет `any`.
- Conventional commits: `fix:` или `feat:` prefix.
- `npm run build` (tsc + esbuild) должен пройти с нулём ошибок.

---

### Task 1: CenterPanel — task card, overdue, search navigation (B1, B8, B9)

**Files:**
- Modify: `src/panels/CenterPanel.ts`
- Modify: `styles.css`

**Interfaces:**
- Produces: `renderTaskCard` с новой структурой DOM (tc-task-meta-right справа), `getFilteredTasks('today')` включает overdue, клик в поиске навигирует к задаче.

- [ ] **Шаг 1: Перестроить renderTaskCard — metadata справа**

В методе `renderTaskCard` (CenterPanel.ts, ~строка 314) изменить DOM-структуру:

```typescript
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

  // Left body: title + optional description
  const body = card.createDiv({ cls: 'tc-task-body' });
  const titleRow = body.createDiv({ cls: 'tc-task-title-row' });
  if (task.time) {
    titleRow.createEl('span', { cls: 'tc-task-time', text: task.time });
  }
  titleRow.createEl('span', { cls: 'tc-task-title', text: task.text });
  if (task.description) {
    body.createDiv({
      cls: 'tc-task-desc',
      text: task.description.split('\n')[0] ?? '',
    });
  }

  // Right metadata: date + tags + progress — always on same line
  const today = window.moment().format('YYYY-MM-DD');
  const sel = this.state.get('selectedList');
  const d = task.due ?? task.scheduled ?? task.dailyNoteDate;
  const tags = task.rawText.match(/#[\w/-]+/gu) ?? [];
  const hasProgress = (task.subtasks?.length ?? 0) > 0;
  const suppressToday = sel === 'today' && d === today;

  const hasRightMeta = (d && !suppressToday) || tags.length > 0 || hasProgress;
  if (hasRightMeta) {
    const metaRight = card.createDiv({ cls: 'tc-task-meta-right' });
    if (d && !suppressToday) {
      metaRight.createEl('span', {
        cls: `tc-task-date${this.isOverdue(d) ? ' is-overdue' : ''}`,
        text: this.formatDate(d),
      });
    }
    for (const tag of tags.slice(0, 2)) {
      metaRight.createEl('span', { cls: 'tc-task-tag', text: tag });
    }
    if (hasProgress) {
      const done = task.subtasks!.filter((s) => s.status === 'done').length;
      metaRight.createEl('span', {
        cls: 'tc-task-progress',
        text: `${done}/${task.subtasks!.length}`,
      });
    }
  }

  card.addEventListener('click', () => {
    this.state.set('taskStack', [task]);
  });

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
```

- [ ] **Шаг 2: Обновить CSS для нового layout task card**

В `styles.css` найти блок `.tc-task-card` и обновить:

```css
.tc-task-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
  position: relative;
}

.tc-task-card:hover {
  background: var(--background-modifier-hover);
}

.tc-task-card.is-selected {
  background: var(--background-modifier-active-hover);
}

.tc-task-body {
  flex: 1;
  min-width: 0;
}

.tc-task-title-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: nowrap;
}

.tc-task-title {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.tc-task-desc {
  font-size: var(--font-smallest, 11px);
  color: var(--text-muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Right-side metadata column */
.tc-task-meta-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  padding-top: 2px;
}
```

- [ ] **Шаг 3: B9 — включить overdue в Today filter**

В методе `getFilteredTasks` (CenterPanel.ts, ~строка 508), изменить case 'today':

```typescript
case 'today':
  tasks = this.store.getTasks().filter((t) => {
    if (t.status !== 'open') return false;
    const d = t.due ?? t.scheduled ?? t.dailyNoteDate;
    // Include today's tasks AND overdue tasks (past due dates)
    if (t.due === today || t.scheduled === today || t.dailyNoteDate === today) return true;
    // Overdue: has a due date in the past
    if (t.due && t.due < today) return true;
    return false;
  });
  break;
```

- [ ] **Шаг 4: B8 — search click navigates to task**

В методе `renderSearch` (CenterPanel.ts), изменить `renderFlat(scroll, results)` на отдельный рендер с click-навигацией:

```typescript
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

  // Render with navigation: clicking task switches to tasks mode and opens it in right panel
  for (const task of results) {
    this.renderTaskCard(scroll, task);
  }

  // Override click behavior: navigate to task in tasks mode
  scroll.querySelectorAll('.tc-task-card').forEach((cardEl, idx) => {
    const task = results[idx];
    if (!task) return;
    cardEl.addEventListener('click', (e) => {
      e.stopPropagation();
      // Determine best list context for this task
      const today = window.moment().format('YYYY-MM-DD');
      const d = task.due ?? task.scheduled ?? task.dailyNoteDate;
      let list: import('../app/AppState').ListSelection = 'inbox';
      if (d === today || (task.due && task.due < today)) {
        list = 'today';
      } else if (d && d > today) {
        list = 'upcoming';
      }
      this.state.set('selectedList', list);
      this.state.set('mode', 'tasks');
      this.state.set('taskStack', [task]);
    }, { capture: true });
  });
}
```

- [ ] **Шаг 5: Сборка и проверка**

```bash
npm run build
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=/tmp/task1-b1-b8-b9.png
```

- [ ] **Шаг 6: Commit**

```bash
git add src/panels/CenterPanel.ts styles.css
git commit -m "fix: task card metadata right-aligned, today includes overdue, search click navigates"
```

---

### Task 2: Calendar panel — nav, list view, styles (B12, B13, B14, B15)

**Files:**
- Modify: `src/panels/CenterPanel.ts` (renderCalendarMode)
- Modify: `src/views/ListView.ts`
- Modify: `styles.css`

**Interfaces:**
- Produces: nav с группировкой кнопок, month/year pickers, style selector, redesigned ListView, чистые active-стили кнопок.

- [ ] **Шаг 1: Добавить поле calStyle в CenterPanel**

В классе `CenterPanel`, после `private calViewInstance`, добавить:

```typescript
private calStyle: string = 'style1';
```

В методе `mount()` инициализировать из settings:

```typescript
mount(container: HTMLElement): void {
  this.el = container;
  this.calStyle = this.settings.desktop.style ?? 'style1';
  this.taskModal = new TaskModal(this.app);
  // ... rest unchanged
}
```

- [ ] **Шаг 2: Переписать renderCalendarMode — новая nav структура**

Заменить метод `renderCalendarMode` в CenterPanel.ts:

```typescript
private renderCalendarMode(): void {
  const nav = this.el.createDiv({ cls: 'tc-cal-nav' });

  // Left group: < [Month Year] >
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

  // Right group: Today | Month | Week | List | Style
  const rightGroup = nav.createDiv({ cls: 'tc-cal-nav-right' });
  const todayBtn = rightGroup.createEl('button', { cls: 'tc-cal-nav-today', text: 'Today' });

  const viewSwitcher = rightGroup.createDiv({ cls: 'tc-cal-view-switcher' });
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

  // Style cycle button (style1..style11)
  const STYLES = ['style1','style2','style3','style4','style5','style6','style7','style8','style9','style10','style11'];
  const styleBtn = rightGroup.createEl('button', {
    cls: 'tc-cal-style-btn',
    attr: { title: 'Change calendar style', 'aria-label': 'Style' },
    text: '🎨',
  });
  styleBtn.addEventListener('click', () => {
    const idx = STYLES.indexOf(this.calStyle);
    this.calStyle = STYLES[(idx + 1) % STYLES.length] ?? 'style1';
    viewContainer.className = `tc-cal-body tasksCalendar ${this.calStyle}`;
    styleBtn.setAttribute('title', `Style: ${this.calStyle}`);
  });

  const calStyle = this.calStyle;
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
          this.calDate = window.moment()
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
        onToggle: (t) => { void this.store.toggleTask(t); },
        onCellClick: () => {},
        onTaskClick: handleTaskClick,
        onDrop: handleDrop,
      });
    } else {
      this.calViewInstance = new ListView({
        onToggle: (t) => { void this.store.toggleTask(t); },
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
    if (existing) { existing.remove(); return; }
    const picker = this.el.createDiv({ cls: 'tc-month-picker tc-popover' });
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    MONTHS.forEach((m, i) => {
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
      const dismiss = (e: MouseEvent) => {
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
    if (existing) { existing.remove(); return; }
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
      const dismiss = (e: MouseEvent) => {
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
    this.calDate =
      this.calViewType === 'week' ? window.moment().startOf('isoWeek') : window.moment().date(1);
    updateTitle();
    mountView();
  });

  this.calUnsubscribe = this.store.onUpdate(() => mountView());
}
```

Note: `ListViewCallbacks` needs `onTaskClick` — update the interface in ListView.ts (Step 3).

- [ ] **Шаг 3: Переписать ListView.ts — информативный вид**

Заменить `src/views/ListView.ts` полностью:

```typescript
import type { Task } from '../parser/types';
import type { ResolvedConfig } from '../settings/types';
import { BaseView } from './BaseView';
import { getTasksForDate, sortTasks } from './taskGrouping';

export interface ListViewCallbacks {
  onToggle: (task: Task) => void;
  onDateClick: (date: string) => void;
  onTaskClick?: (task: Task) => void;
}

export class ListView extends BaseView {
  private containerEl: HTMLElement | null = null;

  constructor(private callbacks: ListViewCallbacks) {
    super();
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.containerEl = container;
    container.empty();

    const today = window.moment().format('YYYY-MM-DD');
    const yesterday = window.moment().subtract(1, 'day').format('YYYY-MM-DD');
    const month = config.startPosition
      ? window.moment(config.startPosition, 'YYYY-MM').date(1)
      : window.moment().date(1);

    const grid = container.createDiv({ cls: 'tc-list-view' });

    // Show overdue tasks first
    const overdueTasks = tasks.filter(
      (t) => t.status === 'open' && t.due && t.due < today,
    );
    if (overdueTasks.length > 0) {
      const section = grid.createDiv({ cls: 'tc-list-section' });
      section.createDiv({ cls: 'tc-list-date-header tc-list-overdue-header', text: 'Overdue' });
      for (const task of sortTasks(overdueTasks)) {
        this.renderListTask(section, task, today);
      }
    }

    for (let i = 1; i <= 31; i++) {
      const currentDate = window.moment(month).date(i).format('YYYY-MM-DD');
      if (window.moment(currentDate).month() !== window.moment(month).month()) break;

      const groups = getTasksForDate(tasks, currentDate, today);
      const allTasks = [
        ...groups.due,
        ...groups.recurrence,
        ...groups.start,
        ...groups.scheduled,
        ...groups.process,
        ...groups.dailyNote,
        ...groups.allDone,
        ...groups.cancelled,
      ];
      if (allTasks.length === 0) continue;

      const section = grid.createDiv({ cls: 'tc-list-section' });

      // Human-readable date header
      let dateLabel: string;
      if (currentDate === today) dateLabel = 'Today';
      else if (currentDate === yesterday) dateLabel = 'Yesterday';
      else dateLabel = window.moment(currentDate).format('ddd, D MMM');

      const dateHeader = section.createDiv({ cls: 'tc-list-date-header' });
      dateHeader.createEl('span', { cls: 'tc-list-date-label', text: dateLabel });
      dateHeader.createEl('span', { cls: 'tc-list-date-count', text: String(allTasks.length) });
      dateHeader.addEventListener('click', () => this.callbacks.onDateClick(currentDate));

      for (const task of sortTasks(allTasks)) {
        this.renderListTask(section, task, today);
      }
    }
  }

  private renderListTask(container: HTMLElement, task: Task, today: string): void {
    const row = container.createDiv({ cls: 'tc-list-task' });

    // Checkbox
    const cb = row.createEl('input', {
      cls: 'tc-task-checkbox',
      attr: { type: 'checkbox' },
    });
    cb.checked = task.status === 'done';
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      this.callbacks.onToggle(task);
    });

    // Title
    const titleSpan = row.createEl('span', {
      cls: `tc-list-task-title${task.status === 'done' ? ' is-done' : ''}`,
      text: task.text,
    });

    // Right metadata
    const meta = row.createDiv({ cls: 'tc-list-task-meta' });
    if (task.time) {
      meta.createEl('span', { cls: 'tc-task-time', text: task.time });
    }
    const tags = task.rawText.match(/#[\w/-]+/gu) ?? [];
    for (const tag of tags.slice(0, 1)) {
      meta.createEl('span', { cls: 'tc-task-tag', text: tag });
    }
    if ((task.subtasks?.length ?? 0) > 0) {
      const done = task.subtasks!.filter((s) => s.status === 'done').length;
      meta.createEl('span', { cls: 'tc-task-progress', text: `${done}/${task.subtasks!.length}` });
    }

    row.addEventListener('click', (e) => {
      if (e.target === cb) return;
      this.callbacks.onTaskClick?.(task);
    });

    // Suppress unused var warning
    void titleSpan;
  }

  destroy(): void {
    this.containerEl = null;
  }
}
```

- [ ] **Шаг 4: B13 — исправить стили кнопок вида в styles.css**

Найти и обновить `.tc-cal-view-btn` и `.tc-cal-nav-today`:

```css
.tc-cal-view-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--font-ui-small);
  transition: background 0.1s, color 0.1s;
}

.tc-cal-view-btn:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

.tc-cal-view-btn.is-active {
  background: var(--interactive-accent);
  color: white;
  font-weight: 500;
}

.tc-cal-nav-today {
  padding: 4px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--font-ui-small);
  transition: background 0.1s, color 0.1s;
}

.tc-cal-nav-today:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
```

- [ ] **Шаг 5: Добавить CSS для новой nav и list view**

```css
/* ── Calendar Nav ─────────────────────────────────────── */
.tc-cal-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  gap: 8px;
}

.tc-cal-nav-left {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tc-cal-nav-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tc-cal-nav-title-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tc-cal-nav-month,
.tc-cal-nav-year {
  background: transparent;
  border: none;
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: 600;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.1s;
}

.tc-cal-nav-month:hover,
.tc-cal-nav-year:hover {
  background: var(--background-modifier-hover);
}

.tc-cal-style-btn {
  padding: 4px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  opacity: 0.6;
  transition: opacity 0.1s;
}
.tc-cal-style-btn:hover { opacity: 1; }

/* Month/Year pickers */
.tc-month-picker,
.tc-year-picker {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 8px;
  min-width: 180px;
  position: absolute;
  z-index: 100;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  box-shadow: var(--shadow-l);
}

.tc-year-picker {
  grid-template-columns: repeat(3, 1fr);
  min-width: 160px;
}

.tc-month-picker-btn,
.tc-year-picker-btn {
  padding: 6px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
  transition: background 0.1s;
}

.tc-month-picker-btn:hover,
.tc-year-picker-btn:hover {
  background: var(--background-modifier-hover);
}

.tc-month-picker-btn.is-active,
.tc-year-picker-btn.is-active {
  background: var(--interactive-accent);
  color: white;
}

/* ── List View ────────────────────────────────────────── */
.tc-list-view {
  padding: 8px 0;
}

.tc-list-section {
  margin-bottom: 16px;
}

.tc-list-date-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 8px;
  cursor: pointer;
}

.tc-list-date-label {
  font-size: var(--font-ui-small);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tc-list-overdue-header .tc-list-date-label {
  color: var(--color-red, #e74c3c);
}

.tc-list-date-count {
  font-size: var(--font-ui-small);
  color: var(--text-faint);
  background: var(--background-modifier-hover);
  border-radius: 10px;
  padding: 0 6px;
}

.tc-list-task {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.tc-list-task:hover {
  background: var(--background-modifier-hover);
}

.tc-list-task-title {
  flex: 1;
  font-size: var(--font-ui-medium);
}

.tc-list-task-title.is-done {
  text-decoration: line-through;
  color: var(--text-muted);
}

.tc-list-task-meta {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
```

- [ ] **Шаг 6: Сборка и проверка**

```bash
npm run build
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=/tmp/task2-calendar.png
```

- [ ] **Шаг 7: Commit**

```bash
git add src/panels/CenterPanel.ts src/views/ListView.ts styles.css
git commit -m "feat: calendar nav grouping, month/year pickers, style selector, redesigned list view"
```

---

### Task 3: RightPanel — bugs (B3, B5, B6, B7)

**Files:**
- Modify: `src/panels/RightPanel.ts`
- Modify: `styles.css`

**Interfaces:**
- Produces: корректный popover времени, toggle context menu, subtask indicators, динамические комментарии.

- [ ] **Шаг 1: B3 — исправить позицию time popover**

В `showTimePopover` заменить:

```typescript
private showTimePopover(anchor: HTMLElement, task: Task): void {
  const already = this.el.querySelector('.tc-time-popover');
  this.clearPopovers();
  if (already) return;

  const pop = this.el.createEl('div', { cls: 'tc-popover tc-time-popover' });
  const input = pop.createEl('input', {
    attr: { type: 'time', value: task.time ?? '' },
  });
  input.focus();
  input.addEventListener('change', () => {
    void this.updateTime(task, input.value).then(() => pop.remove());
  });
  input.addEventListener('blur', () => window.setTimeout(() => pop.remove(), 200));

  // Position below anchor
  this.el.style.position = 'relative';
  pop.style.position = 'absolute';
  pop.style.top = `${anchor.offsetTop + anchor.offsetHeight + 4}px`;
  pop.style.left = `${anchor.offsetLeft}px`;
  pop.style.zIndex = '10';
  this.el.appendChild(pop);
  window.setTimeout(() => input.focus(), 0);
}
```

Also update `showDatePopover` similarly:

```typescript
private showDatePopover(anchor: HTMLElement, task: Task): void {
  const already = this.el.querySelector('.tc-date-popover');
  this.clearPopovers();
  if (already) return;

  const pop = this.el.createDiv({ cls: 'tc-popover tc-date-popover' });
  const input = pop.createEl('input', {
    cls: 'tc-date-input',
    attr: { type: 'date', value: task.due ?? task.scheduled ?? '' },
  });
  input.addEventListener('change', () => {
    void this.updateDate(task, input.value);
    pop.remove();
  });
  input.addEventListener('blur', () => window.setTimeout(() => pop.remove(), 200));

  pop.style.position = 'absolute';
  pop.style.top = `${anchor.offsetTop + anchor.offsetHeight + 4}px`;
  pop.style.left = `${anchor.offsetLeft}px`;
  pop.style.zIndex = '10';
  this.el.style.position = 'relative';
  this.el.appendChild(pop);
  window.setTimeout(() => input.focus(), 0);
}
```

- [ ] **Шаг 2: B5 — исправить context menu toggle + заменить "Copy link"**

Заменить `renderContextMenu`:

```typescript
private renderContextMenu(task: TaskLike, anchor: HTMLElement): void {
  // Toggle: if menu already exists on this button, remove and stop
  const existing = anchor.querySelector('.tc-context-menu');
  if (existing) {
    existing.remove();
    return;
  }
  // Also close any other open menus
  this.el.querySelectorAll('.tc-context-menu').forEach((el) => el.remove());

  const menu = anchor.createEl('div', { cls: 'tc-context-menu' });

  const deleteItem = menu.createEl('div', { cls: 'tc-context-item tc-context-danger', text: 'Delete task' });
  deleteItem.addEventListener('click', () => {
    menu.remove();
    void this.deleteTask(task);
  });

  const openItem = menu.createEl('div', { cls: 'tc-context-item', text: 'Open in file' });
  openItem.addEventListener('click', () => {
    menu.remove();
    void this.openInFile(task);
  });

  const dismiss = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node) && e.target !== anchor) {
      menu.remove();
      activeDocument.removeEventListener('click', dismiss, true);
    }
  };
  window.setTimeout(() => {
    activeDocument.addEventListener('click', dismiss, true);
  }, 0);
}
```

- [ ] **Шаг 3: B6 — subtask indicators**

В методе `renderSubTask`, после создания label, добавить meta-строку если есть вложения:

```typescript
private renderSubTask(container: HTMLElement, sub: SubTask): void {
  const row = container.createDiv({ cls: 'tc-subtask-row' });
  const cb = row.createEl('input', {
    cls: 'tc-task-checkbox',
    attr: { type: 'checkbox' },
  });
  cb.checked = sub.status === 'done';
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    void this.toggleSubTask(sub);
  });

  const content = row.createDiv({ cls: 'tc-subtask-content' });
  const label = content.createEl('span', {
    cls: `tc-subtask-label${sub.status === 'done' ? ' is-done' : ''}`,
    text: sub.text,
  });
  label.addEventListener('click', () => {
    const stack = this.state.get('taskStack');
    this.state.set('taskStack', [...stack, sub]);
  });

  // Show meta indicators for subtasks that have their own subtasks or comments
  const subCount = sub.subtasks?.length ?? 0;
  const commentCount = sub.comments?.length ?? 0;
  if (subCount > 0 || commentCount > 0) {
    const subMeta = content.createDiv({ cls: 'tc-subtask-meta' });
    if (subCount > 0) {
      const done = sub.subtasks!.filter((s) => s.status === 'done').length;
      subMeta.createEl('span', { cls: 'tc-subtask-progress', text: `${done}/${subCount}` });
    }
    if (commentCount > 0) {
      subMeta.createEl('span', { cls: 'tc-subtask-comment-count', text: `💬 ${commentCount}` });
    }
  }
}
```

Add to styles.css:
```css
.tc-subtask-content {
  flex: 1;
  min-width: 0;
}
.tc-subtask-meta {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.tc-subtask-comment-count {
  font-size: var(--font-smallest, 11px);
  color: var(--text-muted);
}
```

- [ ] **Шаг 4: B7 — динамическое обновление комментариев**

В методе `addComment` — после `vault.process`, обновить список комментариев в DOM без полного перерендера. Заменить метод:

```typescript
private async addComment(task: TaskLike, text: string, commentList: HTMLElement, inputEl: HTMLTextAreaElement): Promise<void> {
  const file = this.app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return;
  const today = window.moment().format('YYYY-MM-DD');
  await this.app.vault.process(file, (data) => {
    const lines = data.split('\n');
    const taskLine = lines[task.line];
    if (!taskLine) return data;
    const indent = (/^(\s*)/.exec(taskLine)?.[1] ?? '') + '  ';
    const commentLine = `${indent}- ${today}: ${text}`;
    const insertAt = task.subtaskRange ? task.subtaskRange.to + 1 : task.line + 1;
    lines.splice(insertAt, 0, commentLine);
    return lines.join('\n');
  });
  // Optimistically append to DOM without losing focus
  const row = commentList.createDiv({ cls: 'tc-comment-row' });
  row.createEl('span', { cls: 'tc-comment-date', text: 'Just now' });
  row.createEl('p', { cls: 'tc-comment-text', text });
  inputEl.value = '';
  inputEl.focus();
}
```

Update the call site in `renderTask` — pass `commentList` and `inputEl`:
Change the send button handler to call `this.addComment(task, commentInput.value.trim(), commentList, commentInput)`.

- [ ] **Шаг 5: Сборка и проверка**

```bash
npm run build
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=/tmp/task3-rightpanel.png
```

- [ ] **Шаг 6: Commit**

```bash
git add src/panels/RightPanel.ts styles.css
git commit -m "fix: time popover position, context menu toggle, subtask indicators, dynamic comments"
```

---

### Task 4: RightPanel — секции и стиль (B4)

**Files:**
- Modify: `src/panels/RightPanel.ts`
- Modify: `styles.css`

- [ ] **Шаг 1: Секции — больше отступов + Todoist-стиль комментариев**

В методе `renderTask` (RightPanel.ts), изменить секции:

1. Description section — добавить `tc-right-section--desc` класс
2. Sub-tasks section — убрать `+ add` кнопку из хедера, добавить inline "+ Add sub-task" строку снизу списка:

```typescript
// Sub-tasks section
const subSection = this.el.createDiv({ cls: 'tc-right-section' });
const subHeader = subSection.createDiv({ cls: 'tc-right-section-header' });
subHeader.createEl('span', { cls: 'tc-right-section-label', text: 'Sub-tasks' });
const subProgress = (task.subtasks ?? []).length > 0
  ? `${task.subtasks!.filter(s => s.status === 'done').length}/${task.subtasks!.length}`
  : '';
if (subProgress) {
  subHeader.createEl('span', { cls: 'tc-right-section-count', text: subProgress });
}

const subList = subSection.createDiv({ cls: 'tc-subtask-list' });
for (const sub of task.subtasks ?? []) {
  this.renderSubTask(subList, sub);
}

// Inline "add sub-task" row at the bottom
const addSubRow = subSection.createDiv({ cls: 'tc-subtask-add-row' });
addSubRow.createEl('span', { cls: 'tc-subtask-add-icon', text: '+' });
const addSubLabel = addSubRow.createEl('span', { cls: 'tc-subtask-add-label', text: 'Add sub-task' });
addSubLabel.addEventListener('click', () => {
  addSubRow.style.display = 'none';
  const input = subSection.createEl('input', {
    cls: 'tc-subtask-new-input',
    attr: { type: 'text', placeholder: 'New sub-task…' },
  });
  input.focus();
  const commit = () => {
    if (input.value.trim()) void this.addSubTask(task, input.value.trim());
    input.remove();
    addSubRow.style.display = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { input.remove(); addSubRow.style.display = ''; }
  });
  input.addEventListener('blur', () => window.setTimeout(commit, 150));
});
```

3. Comments section — всегда видимое поле:

```typescript
// Comments section
const commentSection = this.el.createDiv({ cls: 'tc-right-section' });
const commentHeader = commentSection.createDiv({ cls: 'tc-right-section-header' });
commentHeader.createEl('span', { cls: 'tc-right-section-label', text: 'Comments' });
const commentCount = (task.comments ?? []).length;
if (commentCount > 0) {
  commentHeader.createEl('span', { cls: 'tc-right-section-count', text: String(commentCount) });
}

const commentList = commentSection.createDiv({ cls: 'tc-comment-list' });
for (const comment of task.comments ?? []) {
  this.renderComment(commentList, comment);
}

// Always-visible comment input
const commentInput = commentSection.createEl('textarea', {
  cls: 'tc-comment-input',
  attr: { placeholder: 'Write a comment…', rows: '2' },
});
commentInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = commentInput.value.trim();
    if (text) {
      void this.addComment(task, text, commentList, commentInput);
    }
  }
});
```

- [ ] **Шаг 2: CSS секций**

```css
/* ── Right Panel Sections ─────────────────────────────── */
.tc-right-section {
  padding: 16px 16px 0;
}

.tc-right-section + .tc-right-section {
  border-top: 1px solid var(--background-modifier-border);
  margin-top: 8px;
}

.tc-right-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.tc-right-section-label {
  font-size: var(--font-ui-smaller, 11px);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.tc-right-section-count {
  font-size: var(--font-ui-small);
  color: var(--text-faint);
  background: var(--background-modifier-hover);
  border-radius: 10px;
  padding: 0 6px;
}

/* Sub-task inline add row */
.tc-subtask-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0 4px;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: 4px;
  transition: color 0.1s;
}
.tc-subtask-add-row:hover { color: var(--text-normal); }
.tc-subtask-add-icon { font-size: 16px; line-height: 1; }
.tc-subtask-add-label { font-size: var(--font-ui-small); }

/* Comment input — always visible */
.tc-comment-input {
  width: 100%;
  min-height: 60px;
  resize: vertical;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  padding: 8px;
  font-size: var(--font-ui-small);
  background: var(--background-secondary);
  color: var(--text-normal);
  margin-top: 8px;
  box-sizing: border-box;
}

.tc-comment-input:focus {
  outline: none;
  border-color: var(--interactive-accent);
}

/* Comment cards */
.tc-comment-row {
  background: var(--background-secondary);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 6px;
}

.tc-comment-date {
  display: block;
  font-size: var(--font-ui-smaller, 11px);
  color: var(--text-faint);
  margin-bottom: 3px;
}

.tc-comment-text {
  margin: 0;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
}

/* Context menu danger item */
.tc-context-item.tc-context-danger {
  color: var(--color-red, #e74c3c);
}
```

- [ ] **Шаг 3: Сборка**

```bash
npm run build
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=/tmp/task4-sections.png
```

- [ ] **Шаг 4: Commit**

```bash
git add src/panels/RightPanel.ts styles.css
git commit -m "fix: right panel section spacing, Todoist-style comment input, inline add subtask"
```

---

### Task 5: LeftPanel, Modal, Chips (B2, B10, B11)

**Files:**
- Modify: `src/panels/LeftPanel.ts`
- Modify: `src/ui/TaskModal.ts`
- Modify: `styles.css`

- [ ] **Шаг 1: B10 — разделить chevron и name click в LeftPanel**

В методе `renderTagGroup`, разделить header на кликабельные зоны:

```typescript
private renderTagGroup(parent: HTMLElement, group: TagGroup, allTasks: Task[]): void {
  const sel = this.state.get('selectedList');
  const isGroupActive =
    typeof sel === 'object' && sel.type === 'group' && sel.groupId === group.id;

  const tags = this.resolveGroupTags(group, allTasks);

  const hasActiveChild = tags.some(
    (t) => typeof sel === 'object' && sel.type === 'tag' && sel.tag === t,
  );
  if (hasActiveChild && !this.explicitlyCollapsed.has(group.id)) {
    this.expandedGroups.add(group.id);
  }
  const isExpanded = this.expandedGroups.has(group.id);

  const container = parent.createDiv({ cls: 'tc-tag-group' });
  const header = container.createDiv({
    cls: `tc-tag-group-header${isGroupActive ? ' is-active' : ''}`,
  });

  // Chevron: only toggles expand/collapse
  const chevron = header.createEl('span', {
    cls: `tc-left-icon tc-group-arrow${isExpanded ? ' is-open' : ''}`,
    text: isExpanded ? '▼' : '▶',
  });
  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isExpanded) {
      this.expandedGroups.delete(group.id);
      this.explicitlyCollapsed.add(group.id);
    } else {
      this.expandedGroups.add(group.id);
      this.explicitlyCollapsed.delete(group.id);
    }
    this.render();
  });

  if (group.color) {
    const dot = header.createEl('span', { cls: 'tc-group-dot' });
    dot.style.background = group.color;
  }
  header.createEl('span', { cls: 'tc-left-label', text: group.name });

  // Count
  const rootTag = group.mode === 'prefix' && group.prefix ? `#${group.prefix}` : null;
  const allGroupTags = rootTag ? [rootTag, ...tags] : tags;
  const groupCount = allTasks.filter(
    (t) => t.status === 'open' && allGroupTags.some((tag) => t.rawText.includes(tag)),
  ).length;
  if (groupCount > 0) {
    header.createEl('span', { cls: 'tc-left-count', text: String(groupCount) });
  }

  // Name area click: only selects the group (no expand toggle)
  header.addEventListener('click', () => {
    this.state.set('selectedList', { type: 'group', groupId: group.id });
    this.state.set('mode', 'tasks');
  });

  if (isExpanded) {
    const children = container.createDiv({ cls: 'tc-tag-group-children' });
    for (const tag of tags) {
      const label =
        group.mode === 'prefix' && group.prefix
          ? tag.replace(`#${group.prefix}/`, '')
          : tag;

      const tagSel = this.state.get('selectedList');
      const isTagActive =
        typeof tagSel === 'object' && tagSel.type === 'tag' && tagSel.tag === tag;
      const tagCount = allTasks.filter(
        (t) => t.rawText.includes(tag) && t.status === 'open',
      ).length;

      const child = children.createDiv({
        cls: `tc-left-item tc-tag-child${isTagActive ? ' is-active' : ''}`,
      });
      child.createDiv({ cls: 'tc-left-item-left' }, (l) => {
        l.createEl('span', { cls: 'tc-left-label', text: label });
      });
      if (tagCount > 0) child.createEl('span', { cls: 'tc-left-count', text: String(tagCount) });
      child.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.set('selectedList', { type: 'tag', tag });
        this.state.set('mode', 'tasks');
      });
    }
  }
}
```

- [ ] **Шаг 2: B11 — fix modal close button position**

В `src/ui/TaskModal.ts`, убрать `position: absolute` с close button. Вместо этого — после монтирования RightPanel добавить close button в tc-right-header-actions:

```typescript
open(task: Task): void {
  this.close();
  this.ownerDoc = activeDocument;
  this.innerState = new AppState();
  this.innerState.set('taskStack', [task]);

  const backdrop = this.ownerDoc.body.createDiv({ cls: 'tc-modal-backdrop' });
  this.backdropEl = backdrop;

  const modal = backdrop.createDiv({ cls: 'tc-modal' });
  const panelEl = modal.createDiv({ cls: 'tc-right tc-modal-body' });
  this.innerPanel = new RightPanel(this.innerState, this.app);
  this.innerPanel.mount(panelEl);

  // Insert close button into RightPanel's header-actions div (no position conflict)
  const headerActions = panelEl.querySelector('.tc-right-header-actions');
  const closeBtn = activeDocument.createElement('button');
  closeBtn.className = 'tc-right-action-btn tc-modal-close-btn';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.setAttribute('title', 'Close');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => this.close());
  if (headerActions) {
    headerActions.appendChild(closeBtn);
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) this.close();
  });

  this.keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };
  this.ownerDoc.addEventListener('keydown', this.keyHandler);
}
```

Обновить CSS — убрать `position: absolute` с `.tc-modal-close-btn`:
```css
.tc-modal-close-btn {
  /* No position: absolute needed — it's now in the header-actions flex row */
}
```

- [ ] **Шаг 3: B2 — чистый стиль чипов**

В `styles.css` найти и обновить чипы:

```css
/* ── Chips ────────────────────────────────────────────── */
.tc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  font-size: 12px;
  color: var(--text-normal);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.1s, background 0.1s;
  user-select: none;
}

.tc-chip:hover {
  background: var(--background-modifier-hover);
  border-color: var(--interactive-accent);
}

.tc-chip-empty {
  color: var(--text-muted);
  border-style: dashed;
}

.tc-chip-tag {
  background: var(--background-secondary);
  border-color: var(--background-modifier-border);
}

.tc-chip-add {
  background: transparent;
  border-style: dashed;
  color: var(--text-muted);
}

.tc-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
  padding: 0;
  transition: background 0.1s, color 0.1s;
}
.tc-chip-remove:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
```

- [ ] **Шаг 4: Сборка и проверка**

```bash
npm run build
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=/tmp/task5-leftmodal.png
```

- [ ] **Шаг 5: Commit**

```bash
git add src/panels/LeftPanel.ts src/ui/TaskModal.ts styles.css
git commit -m "fix: tag group chevron separates from select, modal close button, chip style cleanup"
```

---

## Self-review

**Spec coverage:**
- ✅ B1: task card metadata right — Task 1 Step 1-2
- ✅ B2: chip styles — Task 5 Step 3
- ✅ B3: time popover position — Task 3 Step 1
- ✅ B4: section spacing + Todoist comments — Task 4 Step 1-2
- ✅ B5: context menu toggle + "Open in file" — Task 3 Step 2
- ✅ B6: subtask indicators — Task 3 Step 3
- ✅ B7: dynamic comments — Task 3 Step 4
- ✅ B8: search click nav — Task 1 Step 4
- ✅ B9: today overdue — Task 1 Step 3
- ✅ B10: chevron vs name click — Task 5 Step 1
- ✅ B11: modal close button position — Task 5 Step 2
- ✅ B12: calendar nav grouping + pickers — Task 2 Step 2
- ✅ B13: view button active state — Task 2 Step 4
- ✅ B14: list view redesign — Task 2 Step 3
- ✅ B15: style selector — Task 2 Step 2

**Placeholder scan:** нет TBD/TODO.

**Type consistency:**
- `ListViewCallbacks.onTaskClick?: (task: Task) => void` — optional, Task 2 Step 3 и Step 2.
- `addComment` новая сигнатура с `commentList, inputEl` — используется только в Task 3/4.
- `renderContextMenu` та же сигнатура `(task, anchor)` — Task 3 Step 2.
