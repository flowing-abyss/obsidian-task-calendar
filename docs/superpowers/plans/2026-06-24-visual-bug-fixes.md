# Visual Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix 13 visual and functional bugs in the Task Calendar plugin.

**Architecture:** Changes split into 5 sequentially independent tasks by component: CenterPanel task list (B1/B8/B9), CenterPanel calendar (B12/B13/B14/B15), RightPanel core bugs (B3/B5/B6/B7), RightPanel sections (B4), LeftPanel+Modal+CSS (B2/B10/B11).

**Tech Stack:** TypeScript, Obsidian Plugin API, vanilla DOM, moment.js.

## Global Constraints

- Use `activeDocument` instead of `document` (Obsidian lint rule).
- DOM via Obsidian helpers: `createDiv()`, `createEl()`.
- Write to files only via `app.vault.process()`.
- Strict TypeScript: no `any`.
- Conventional commits: `fix:` or `feat:` prefix.
- `npm run build` (tsc + esbuild) must pass with zero errors.
- Code comments in English.

---

### Task 1: CenterPanel — task card, overdue, search navigation (B1, B8, B9)

**Files:**
- Modify: `src/panels/CenterPanel.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `Task` from `../parser/types`, `AppState` state fields: `taskStack`, `selectedList`, `mode`, `searchQuery`
- Produces: `renderTaskCard` with new DOM structure (`.tc-task-meta-right` on right), `getFilteredTasks('today')` includes overdue, clicking task in search view navigates to tasks mode

- [ ] **Step 1: Restructure renderTaskCard — metadata on the right**

Find `renderTaskCard` method in `src/panels/CenterPanel.ts`. Replace the task card DOM construction to match this structure:

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

Note: `this.isOverdue(d)` and `this.formatDate(d)` must already exist in CenterPanel. If they don't, add them:
```typescript
private isOverdue(date: string): boolean {
  return date < window.moment().format('YYYY-MM-DD');
}

private formatDate(date: string): string {
  const m = window.moment(date, 'YYYY-MM-DD');
  const today = window.moment().startOf('day');
  const diff = m.diff(today, 'days');
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return m.format('MMM D');
}
```

- [ ] **Step 2: Update CSS for new task card layout**

In `styles.css`, find `.tc-task-card` block and update:

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

.tc-task-meta-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  padding-top: 2px;
}
```

- [ ] **Step 3: B9 — include overdue in Today filter**

Find `getFilteredTasks` method in `CenterPanel.ts`. Change `case 'today':` to:

```typescript
case 'today': {
  const todayStr = window.moment().format('YYYY-MM-DD');
  tasks = this.store.getTasks().filter((t) => {
    if (t.status !== 'open') return false;
    if (t.due === todayStr || t.scheduled === todayStr || t.dailyNoteDate === todayStr) return true;
    if (t.due && t.due < todayStr) return true;
    return false;
  });
  break;
}
```

- [ ] **Step 4: B8 — search click navigates to task**

Find `renderSearch` method in `CenterPanel.ts`. After rendering each task card in the search results list, attach a capturing click listener that navigates to tasks mode:

```typescript
// After the loop that renders task cards in search results:
scroll.querySelectorAll<HTMLElement>('.tc-task-card').forEach((cardEl, idx) => {
  const task = results[idx];
  if (!task) return;
  cardEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const todayStr = window.moment().format('YYYY-MM-DD');
    const d = task.due ?? task.scheduled ?? task.dailyNoteDate;
    let list: string = 'inbox';
    if ((task.due && task.due < todayStr) || d === todayStr) {
      list = 'today';
    } else if (d && d > todayStr) {
      list = 'upcoming';
    }
    this.state.set('selectedList', list as Parameters<typeof this.state.set>[1]);
    this.state.set('mode', 'tasks');
    this.state.set('taskStack', [task]);
  }, { capture: true });
});
```

Check AppState.ts for the exact type used for `selectedList`. If `set` is generic, use the correct type for the value. Adjust the cast accordingly.

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Expected: zero TypeScript errors, zero esbuild errors.

```bash
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=screenshot-b1-b8-b9.png
```

- [ ] **Step 6: Commit**

```bash
git add src/panels/CenterPanel.ts styles.css
git commit -m "fix: task card metadata right-aligned, today includes overdue, search click navigates"
```

---

### Task 2: Calendar panel — nav, list view, styles (B12, B13, B14, B15)

**Files:**
- Modify: `src/panels/CenterPanel.ts`
- Modify: `src/views/ListView.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `MonthView`, `WeekView`, `ListView` from their respective files; `ResolvedConfig` from `../settings/types`; `Task` type; `setIcon`, `activeDocument` from obsidian
- Produces: calendar nav with grouped buttons, month/year picker popovers, 🎨 style cycle button, redesigned ListView with human-readable dates, clean active-state button styles

- [ ] **Step 1: Add calStyle field to CenterPanel**

Read `src/panels/CenterPanel.ts` and `src/settings/types.ts` to find the exact settings field for calendar style (look for `style`, `calendarStyle`, or similar in `DesktopConfig`/`ResolvedConfig`).

Add after existing view-related field declarations in `CenterPanel`:

```typescript
private calStyle: string = 'style1';
```

In `mount()`, initialize from settings:

```typescript
this.calStyle = (this.settings.desktop as Record<string, unknown>)['style'] as string ?? 'style1';
```

Use the actual field name found in `types.ts`.

- [ ] **Step 2: Rewrite renderCalendarMode — new nav structure**

Read the existing `renderCalendarMode` to find exact field names (`this.calViewType`, `this.calDate`, `this.calViewInstance`, `this.calUnsubscribe`, `this.settings`, `this.store`, `this.taskModal`). Then replace the method body:

```typescript
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

  const CAL_STYLES = [
    'style1','style2','style3','style4','style5','style6',
    'style7','style8','style9','style10','style11',
  ];
  const styleBtn = rightGroup.createEl('button', {
    cls: 'tc-cal-style-btn',
    attr: { title: `Style: ${this.calStyle}`, 'aria-label': 'Cycle calendar style' },
    text: '🎨',
  });

  const viewContainer = this.el.createDiv({
    cls: `tc-cal-body tasksCalendar ${this.calStyle}`,
  });

  styleBtn.addEventListener('click', () => {
    const idx = CAL_STYLES.indexOf(this.calStyle);
    this.calStyle = CAL_STYLES[(idx + 1) % CAL_STYLES.length] ?? 'style1';
    viewContainer.className = `tc-cal-body tasksCalendar ${this.calStyle}`;
    styleBtn.setAttribute('title', `Style: ${this.calStyle}`);
  });

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
    const tasks = this.store.getTasks();
    const cfg: ResolvedConfig = {
      ...DEFAULT_VIEW_CONFIG,
      ...this.settings.desktop,
      isMobile: false,
      startPosition: this.calDate.format(
        this.calViewType === 'week' ? 'YYYY-ww' : 'YYYY-MM',
      ),
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
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
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
    if (existing) { existing.remove(); return; }
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
      this.calViewType === 'week'
        ? window.moment().startOf('isoWeek')
        : window.moment().date(1);
    updateTitle();
    mountView();
  });

  this.calUnsubscribe = this.store.onUpdate(() => mountView());
}
```

Note: `DEFAULT_VIEW_CONFIG` may need to be imported or already exists in scope. Check existing `renderCalendarMode` for how config was constructed.

- [ ] **Step 3: Rewrite ListView.ts — informative list view**

Read `src/views/taskGrouping.ts` to check the exact return type of `getTasksForDate` (field names like `due`, `scheduled`, etc.). Read `src/views/BaseView.ts` for the `BaseView` class interface. Read the existing `src/views/ListView.ts` for imports.

Then replace `src/views/ListView.ts` entirely:

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
  constructor(private callbacks: ListViewCallbacks) {
    super();
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    container.empty();

    const today = window.moment().format('YYYY-MM-DD');
    const yesterday = window.moment().subtract(1, 'day').format('YYYY-MM-DD');
    const month = config.startPosition
      ? window.moment(config.startPosition, 'YYYY-MM').date(1)
      : window.moment().date(1);

    const grid = container.createDiv({ cls: 'tc-list-view' });

    // Overdue section first
    const overdueTasks = tasks.filter(
      (t) => t.status === 'open' && t.due && t.due < today,
    );
    if (overdueTasks.length > 0) {
      const section = grid.createDiv({ cls: 'tc-list-section' });
      const overdueHeader = section.createDiv({ cls: 'tc-list-date-header tc-list-overdue-header' });
      overdueHeader.createEl('span', { cls: 'tc-list-date-label', text: 'Overdue' });
      overdueHeader.createEl('span', { cls: 'tc-list-date-count', text: String(overdueTasks.length) });
      for (const task of sortTasks(overdueTasks)) {
        this.renderListTask(section, task);
      }
    }

    for (let i = 1; i <= 31; i++) {
      const currentDate = window.moment(month).date(i).format('YYYY-MM-DD');
      if (window.moment(currentDate).month() !== window.moment(month).month()) break;

      const groups = getTasksForDate(tasks, currentDate, today);
      // Combine all task groups — adjust field names to match taskGrouping.ts actual return
      const allTasks: Task[] = [];
      for (const group of Object.values(groups)) {
        if (Array.isArray(group)) allTasks.push(...(group as Task[]));
      }
      if (allTasks.length === 0) continue;

      const section = grid.createDiv({ cls: 'tc-list-section' });

      let dateLabel: string;
      if (currentDate === today) dateLabel = 'Today';
      else if (currentDate === yesterday) dateLabel = 'Yesterday';
      else dateLabel = window.moment(currentDate).format('ddd, D MMM');

      const dateHeader = section.createDiv({ cls: 'tc-list-date-header' });
      dateHeader.createEl('span', { cls: 'tc-list-date-label', text: dateLabel });
      dateHeader.createEl('span', {
        cls: 'tc-list-date-count',
        text: String(allTasks.length),
      });
      dateHeader.addEventListener('click', () => this.callbacks.onDateClick(currentDate));

      for (const task of sortTasks(allTasks)) {
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

    row.createEl('span', {
      cls: `tc-list-task-title${task.status === 'done' ? ' is-done' : ''}`,
      text: task.text,
    });

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
```

- [ ] **Step 4: B13 — fix view button active state in styles.css**

Find the existing `.tc-cal-view-btn` or `.tc-view-btn` selector in `styles.css`. Replace all rules for that selector and add `.is-active`:

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

- [ ] **Step 5: Add CSS for new nav and list view**

Add these new rules to `styles.css` (in a new section after existing calendar styles):

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

.tc-cal-view-switcher {
  display: flex;
  gap: 2px;
  background: var(--background-modifier-border);
  border-radius: 8px;
  padding: 2px;
}

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

.tc-list-overdue-header .tc-list-date-label,
.tc-list-overdue-header {
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

- [ ] **Step 6: Build and verify**

```bash
npm run build
```

Expected: zero errors.

```bash
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=screenshot-b12-b13-b14-b15.png
```

- [ ] **Step 7: Commit**

```bash
git add src/panels/CenterPanel.ts src/views/ListView.ts styles.css
git commit -m "feat: calendar nav grouping, month/year pickers, style selector, redesigned list view"
```

---

### Task 3: RightPanel — popovers, context menu, subtask indicators, dynamic comments (B3, B5, B6, B7)

**Files:**
- Modify: `src/panels/RightPanel.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `Task`, `SubTask` (check actual type names in `../parser/types`); `TFile` from obsidian; `activeDocument` from obsidian
- Produces: fixed `showTimePopover` and `showDatePopover` (absolute positioning), toggle-aware `renderContextMenu`, `renderSubTask` with nested data indicators, `addComment` with optimistic DOM update and new signature `(task, text, commentList, inputEl)`

**Required reading first:** Read `src/panels/RightPanel.ts` fully before writing any code — find exact method names, field names, the `TaskLike` type if it exists, whether `clearPopovers` exists, whether `openInFile` exists, and where `addComment` is called.

- [ ] **Step 1: B3 — fix time and date popover position**

Find `showTimePopover` in `RightPanel.ts`. Replace implementation (using exact position calculation):

```typescript
private showTimePopover(anchor: HTMLElement, task: Task): void {
  const already = this.el.querySelector('.tc-time-popover');
  this.el.querySelectorAll('.tc-popover').forEach((el) => el.remove());
  if (already) return;

  this.el.style.position = 'relative';
  const pop = this.el.createDiv({ cls: 'tc-popover tc-time-popover' });
  pop.style.position = 'absolute';
  pop.style.top = `${anchor.offsetTop + anchor.offsetHeight + 4}px`;
  pop.style.left = `${anchor.offsetLeft}px`;
  pop.style.zIndex = '10';

  const input = pop.createEl('input', {
    attr: { type: 'time', value: task.time ?? '' },
  });
  window.setTimeout(() => input.focus(), 0);
  input.addEventListener('change', () => {
    void this.updateTime(task, input.value).then(() => pop.remove());
  });
  input.addEventListener('blur', () => window.setTimeout(() => pop.remove(), 200));
}
```

Apply the same pattern to `showDatePopover` if it exists (same structure, use `.tc-date-popover` class, input type `date`).

- [ ] **Step 2: B5 — fix context menu toggle + "Open in file"**

Find `renderContextMenu`. Replace:

```typescript
private renderContextMenu(task: TaskLike, anchor: HTMLElement): void {
  const existing = anchor.querySelector('.tc-context-menu');
  if (existing) {
    existing.remove();
    return;
  }
  this.el.querySelectorAll('.tc-context-menu').forEach((el) => el.remove());

  const menu = anchor.createDiv({ cls: 'tc-context-menu' });

  const deleteItem = menu.createDiv({
    cls: 'tc-context-item tc-context-danger',
    text: 'Delete task',
  });
  deleteItem.addEventListener('click', () => {
    menu.remove();
    void this.deleteTask(task);
  });

  const openItem = menu.createDiv({
    cls: 'tc-context-item',
    text: 'Open in file',
  });
  openItem.addEventListener('click', () => {
    menu.remove();
    void this.openInFile(task);
  });

  window.setTimeout(() => {
    const dismiss = (e: MouseEvent): void => {
      if (!menu.contains(e.target as Node) && e.target !== anchor) {
        menu.remove();
        activeDocument.removeEventListener('click', dismiss, true);
      }
    };
    activeDocument.addEventListener('click', dismiss, true);
  }, 0);
}
```

Use the actual type of `task` parameter in the existing `renderContextMenu` signature — keep it unchanged (it may be `Task`, `SubTask`, or a union type `TaskLike`).

If `openInFile` doesn't exist, add it:

```typescript
private async openInFile(task: { filePath: string; line: number }): Promise<void> {
  const file = this.app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return;
  const leaf = this.app.workspace.getUnpinnedLeaf();
  await leaf.openFile(file);
  // Scroll to line
  const view = leaf.view;
  if ('editor' in view) {
    (view as { editor: { setCursor: (pos: { line: number; ch: number }) => void } }).editor.setCursor({ line: task.line, ch: 0 });
  }
}
```

- [ ] **Step 3: B6 — subtask indicators**

Find `renderSubTask`. After the existing label span, add the meta row:

```typescript
// Find the content wrapper div (or the row itself if there's no wrapper)
// Add after the label:
const subCount = sub.subtasks?.length ?? 0;
const commentCount = sub.comments?.length ?? 0;
if (subCount > 0 || commentCount > 0) {
  const subMeta = content.createDiv({ cls: 'tc-subtask-meta' });
  if (subCount > 0) {
    const done = sub.subtasks!.filter((s) => s.status === 'done').length;
    subMeta.createEl('span', {
      cls: 'tc-subtask-progress',
      text: `${done}/${subCount}`,
    });
  }
  if (commentCount > 0) {
    subMeta.createEl('span', {
      cls: 'tc-subtask-comment-count',
      text: `💬 ${commentCount}`,
    });
  }
}
```

If there's no `content` div (label is directly in `row`), wrap it:
```typescript
const content = row.createDiv({ cls: 'tc-subtask-content' });
// move label creation into content
```

- [ ] **Step 4: B7 — optimistic comment update**

Find `addComment` and its call site in `renderTask`. Update the method signature and body:

```typescript
private async addComment(
  task: TaskLike,
  text: string,
  commentList: HTMLElement,
  inputEl: HTMLTextAreaElement,
): Promise<void> {
  // Optimistic DOM update first
  const row = commentList.createDiv({ cls: 'tc-comment-row' });
  row.createEl('span', { cls: 'tc-comment-date', text: 'Just now' });
  row.createEl('p', { cls: 'tc-comment-text', text });
  inputEl.value = '';
  inputEl.focus();

  // Write to file
  const file = this.app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return;
  const today = window.moment().format('YYYY-MM-DD');
  await this.app.vault.process(file, (data) => {
    const lines = data.split('\n');
    const taskLine = lines[task.line];
    if (!taskLine) return data;
    const indent = (/^(\s*)/.exec(taskLine)?.[1] ?? '') + '  ';
    const commentLine = `${indent}- ${today}: ${text}`;
    const insertAt =
      'subtaskRange' in task && task.subtaskRange
        ? (task.subtaskRange as { to: number }).to + 1
        : task.line + 1;
    lines.splice(insertAt, 0, commentLine);
    return lines.join('\n');
  });
}
```

Update the call site to pass `commentList` and `inputEl`. The send button handler should become:
```typescript
sendBtn.addEventListener('click', () => {
  const text = commentInput.value.trim();
  if (text) void this.addComment(task, text, commentList, commentInput);
});
// Also for Enter key handler if one exists
```

Use the exact type for `task` that `addComment` already used.

- [ ] **Step 5: Add CSS**

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

.tc-subtask-progress {
  font-size: var(--font-smallest, 11px);
  color: var(--text-muted);
  background: var(--background-modifier-hover);
  border-radius: 8px;
  padding: 0 5px;
}

.tc-subtask-comment-count {
  font-size: var(--font-smallest, 11px);
  color: var(--text-muted);
}

.tc-context-item.tc-context-danger {
  color: var(--color-red, #e74c3c);
}

.tc-right {
  position: relative;
}
```

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: zero errors.

```bash
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=screenshot-b3-b5-b6-b7.png
```

- [ ] **Step 7: Commit**

```bash
git add src/panels/RightPanel.ts styles.css
git commit -m "fix: time popover position, context menu toggle, subtask indicators, dynamic comments"
```

---

### Task 4: RightPanel — section layout + Todoist-style comments (B4)

**Files:**
- Modify: `src/panels/RightPanel.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `Task`, `SubTask` types; updated `addComment(task, text, commentList, inputEl)` signature from Task 3
- Produces: redesigned section layout (border separator, 16px padding), inline add-subtask row at bottom of list, always-visible comment textarea with Enter-to-submit

**Required reading first:** Read `src/panels/RightPanel.ts` fully to find `renderTask` method and how it currently builds the description, subtasks, and comments sections. Find the actual method name for adding subtasks (`addSubTask` or similar).

- [ ] **Step 1: Redesign sub-tasks section in renderTask**

Find the subtasks section in `renderTask`. Replace with:

```typescript
const subSection = taskEl.createDiv({ cls: 'tc-right-section' });
const subHeader = subSection.createDiv({ cls: 'tc-right-section-header' });
subHeader.createEl('span', { cls: 'tc-right-section-label', text: 'Sub-tasks' });
const totalSubs = task.subtasks?.length ?? 0;
if (totalSubs > 0) {
  const doneSubs = task.subtasks!.filter((s) => s.status === 'done').length;
  subHeader.createEl('span', {
    cls: 'tc-right-section-count',
    text: `${doneSubs}/${totalSubs}`,
  });
}

const subList = subSection.createDiv({ cls: 'tc-subtask-list' });
for (const sub of task.subtasks ?? []) {
  this.renderSubTask(subList, sub);
}

const addSubRow = subSection.createDiv({ cls: 'tc-subtask-add-row' });
addSubRow.createEl('span', { cls: 'tc-subtask-add-icon', text: '+' });
addSubRow.createEl('span', { cls: 'tc-subtask-add-label', text: 'Add sub-task' });
addSubRow.addEventListener('click', () => {
  addSubRow.style.display = 'none';
  const input = subSection.createEl('input', {
    cls: 'tc-subtask-new-input',
    attr: { type: 'text', placeholder: 'New sub-task…' },
  });
  input.focus();
  const commit = (): void => {
    if (input.value.trim()) void this.addSubTask(task, input.value.trim());
    input.remove();
    addSubRow.style.display = '';
  };
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { input.remove(); addSubRow.style.display = ''; }
  });
  input.addEventListener('blur', () => window.setTimeout(commit, 150));
});
```

Use the exact method name for adding subtasks found in the existing code.

- [ ] **Step 2: Redesign comments section in renderTask**

Find the comments section in `renderTask`. Replace with:

```typescript
const commentSection = taskEl.createDiv({ cls: 'tc-right-section' });
const commentHeader = commentSection.createDiv({ cls: 'tc-right-section-header' });
commentHeader.createEl('span', { cls: 'tc-right-section-label', text: 'Comments' });
const commentCount = task.comments?.length ?? 0;
if (commentCount > 0) {
  commentHeader.createEl('span', {
    cls: 'tc-right-section-count',
    text: String(commentCount),
  });
}

const commentList = commentSection.createDiv({ cls: 'tc-comment-list' });
for (const comment of task.comments ?? []) {
  this.renderComment(commentList, comment);
}

const commentInput = commentSection.createEl('textarea', {
  cls: 'tc-comment-input',
  attr: { placeholder: 'Write a comment…', rows: '2' },
});
commentInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = commentInput.value.trim();
    if (text) {
      void this.addComment(task, text, commentList, commentInput);
    }
  }
});
```

Remove the old "Add comment" button and its handler.

- [ ] **Step 3: Add section CSS**

```css
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

.tc-subtask-new-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--interactive-accent);
  border-radius: 4px;
  background: var(--background-secondary);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  margin: 4px 0;
  box-sizing: border-box;
}

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
  display: block;
}

.tc-comment-input:focus {
  outline: none;
  border-color: var(--interactive-accent);
}

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
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: zero errors.

```bash
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=screenshot-b4.png
```

- [ ] **Step 5: Commit**

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

**Interfaces:**
- Consumes: `AppState`, `TagGroup` type; `RightPanel.mount()` API; `activeDocument` from obsidian
- Produces: separate chevron (expand-only) vs header (select-only) click zones in `renderTagGroup`; `TaskModal.open()` inserts close button into `.tc-right-header-actions` (not absolutely positioned); uniform 24px chip height

**Required reading first:** Read `src/panels/LeftPanel.ts` and `src/ui/TaskModal.ts` before writing code.

- [ ] **Step 1: B10 — split chevron vs header click in renderTagGroup**

Find `renderTagGroup` in `src/panels/LeftPanel.ts`. The header currently has a single click handler doing both expand and select. Split it:

1. Create the chevron element separately with `e.stopPropagation()` in its click handler (only toggles expand):

```typescript
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
```

2. Keep the header's click handler but remove expand/collapse logic — select only:

```typescript
header.addEventListener('click', () => {
  this.state.set('selectedList', { type: 'group', groupId: group.id });
  this.state.set('mode', 'tasks');
});
```

Match the exact existing field names on `expandedGroups` and `explicitlyCollapsed`. Check if `expandedGroups` is a `Set<string>` and what `group.id` is. Match the exact `selectedList` value shape used elsewhere in LeftPanel.

- [ ] **Step 2: B11 — fix modal close button position**

Find `open` method in `src/ui/TaskModal.ts`. Remove the existing absolute-positioned close button. After `this.innerPanel.mount(panelEl)`, insert close button into header-actions:

```typescript
const headerActions = panelEl.querySelector<HTMLElement>('.tc-right-header-actions');
const closeBtn = activeDocument.createElement('button');
closeBtn.className = 'tc-right-action-btn tc-modal-close-btn';
closeBtn.setAttribute('aria-label', 'Close');
closeBtn.setAttribute('title', 'Close');
closeBtn.textContent = '✕';
closeBtn.addEventListener('click', () => this.close());
if (headerActions) {
  headerActions.appendChild(closeBtn);
} else {
  panelEl.appendChild(closeBtn);
}
```

- [ ] **Step 3: Remove absolute positioning from modal close button CSS**

In `styles.css`, find `.tc-modal-close-btn` and remove any `position: absolute`, `top`, `right`, `z-index` properties. The button is now in the flex row:

```css
.tc-modal-close-btn {
  /* positioned inside .tc-right-header-actions flex row */
}
```

- [ ] **Step 4: B2 — uniform chip styles**

Find `.tc-chip` in `styles.css`. Update all chip-related rules:

```css
.tc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  font-size: 12px;
  color: var(--text-normal);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.1s, background 0.1s;
  user-select: none;
  box-sizing: border-box;
  vertical-align: middle;
}

.tc-chip:hover {
  background: var(--background-modifier-hover);
  border-color: var(--interactive-accent);
}

.tc-chip-empty {
  color: var(--text-muted);
  border-style: dashed;
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
  flex-shrink: 0;
  transition: background 0.1s, color 0.1s;
}
.tc-chip-remove:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
```

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Expected: zero errors.

```bash
obsidian plugin:reload id=task-calendar
obsidian dev:screenshot path=screenshot-b2-b10-b11.png
```

- [ ] **Step 6: Commit**

```bash
git add src/panels/LeftPanel.ts src/ui/TaskModal.ts styles.css
git commit -m "fix: tag group chevron separates from select, modal close button, chip style cleanup"
```

---

## Self-Review

**Spec coverage:**
- ✅ B1: task card metadata right — Task 1 Step 1-2
- ✅ B2: chip styles — Task 5 Step 4
- ✅ B3: time popover position — Task 3 Step 1
- ✅ B4: section spacing + Todoist comments — Task 4 Step 1-3
- ✅ B5: context menu toggle + "Open in file" — Task 3 Step 2
- ✅ B6: subtask indicators — Task 3 Step 3
- ✅ B7: dynamic comments — Task 3 Step 4
- ✅ B8: search click nav — Task 1 Step 4
- ✅ B9: today overdue — Task 1 Step 3
- ✅ B10: chevron vs name click — Task 5 Step 1
- ✅ B11: modal close button position — Task 5 Step 2-3
- ✅ B12: calendar nav grouping + pickers — Task 2 Step 2
- ✅ B13: view button active state — Task 2 Step 4
- ✅ B14: list view redesign — Task 2 Step 3
- ✅ B15: style selector — Task 2 Step 1-2

**Placeholder scan:** No TBD/TODO. All steps have concrete code.

**Type consistency:**
- `ListViewCallbacks.onTaskClick?: (task: Task) => void` — optional, defined in Task 2 Step 3, consumed in Task 2 Step 2.
- `addComment` new signature `(task, text, commentList, inputEl)` — defined in Task 3 Step 4, call site updated there; Task 4 Step 2 uses the new signature.
- `renderContextMenu` same parameter order — Task 3 Step 2.
- Task 3 Step 3: `content` variable assumed to be a wrapper div in `renderSubTask` — implementer must verify structure and add wrapper if missing.
