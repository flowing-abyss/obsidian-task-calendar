# Sort / Group / Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-list-persistent sort, group-by, show-status controls and click-to-filter property chips to the CenterPanel task list.

**Architecture:** A `ListViewState` struct (groupBy / sortBy / show / filters) is stored per list key in `CalendarSettings.listViewStates` and mirrored live on `AppState.centerListViewState`. CenterPanel reads this state for rendering and writes it back to settings on every change and on list switch. A custom popover dropdown exposes Group by / Sort by / Show controls; clicking metadata elements on task cards adds dismissible filter chips.

**Tech Stack:** TypeScript, Obsidian plugin API (custom DOM popover, no Obsidian `Menu` for the dropdown), Vitest for tests.

## Global Constraints

- All CSS classes use the `tc-` prefix.
- No external dependencies — DOM manipulation only via Obsidian's `createEl` / `createDiv` / `setIcon`.
- Strict TypeScript — no `any`, no `as unknown` casts except where existing code already uses them.
- Conventional commit messages (`feat:`, `fix:`, `refactor:`, `test:`, `style:`).
- Run `npm run test:unit` after each task; all tests must pass before committing.
- `onSaveSettings` parameter on `CenterPanel` is optional (default no-op) so existing tests need zero changes to their `new CenterPanel(...)` calls.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/settings/types.ts` | Modify | Add `PropertyFilter`, `ListViewState`, `listViewStates` to `CalendarSettings` |
| `src/settings/defaults.ts` | Modify | Add `getListViewDefaults(key: string)` — takes a string, NO import from AppState |
| `src/panels/CenterPanel.ts` (module level) | Modify | Add `listSelectionToKey()` as a module-level function to avoid circular import |
| `src/app/AppState.ts` | Modify | Add `centerListViewState: ListViewState` |
| `src/views/taskGrouping.ts` | Modify | Add `sortTasksByField()`, `groupTasksByPriority()`, `groupTasksByTag()`, `groupTasksByDate()` |
| `src/ui/sourceNoteChip.ts` | Modify | Accept optional `onClick` callback |
| `src/panels/CenterPanel.ts` | Modify | Header layout, chips, dropdown, click-to-filter, per-list state, new rendering pipeline |
| `src/views/PanelView.ts` | Modify | Pass `onSaveSettings` callback to `CenterPanel` |
| `src/main.ts` | Modify | Pass `() => this.saveSettings()` through `PanelView` |
| `styles.css` | Modify | Styles for chips, `[↕]` button, dropdown popover, new group headers |
| `test/task-grouping.test.ts` | Modify | Tests for new sort/group functions |
| `test/app-state.test.ts` | Modify | Test `centerListViewState` initial value |

---

### Task 1: Add `ListViewState` types, defaults, and `listViewStates` to settings

**Files:**
- Modify: `src/settings/types.ts`
- Modify: `src/settings/defaults.ts`
- Test: `test/app-state.test.ts` (add one assertion), `test/task-grouping.test.ts` (no change here, just noting)

**Interfaces:**
- Produces: `PropertyFilter`, `ListViewState`, `getListViewDefaults(key: string)` (string param only — no ListSelection import → no circular dep)

- [ ] **Step 1: Add types to `src/settings/types.ts`**

Append before the closing of the file (after the last export):

```typescript
import type { TaskPriority } from '../parser/types';

export type PropertyFilter =
  | { type: 'tag'; value: string }
  | { type: 'file'; filePath: string }
  | { type: 'time'; value: string }
  | { type: 'priority'; value: TaskPriority };

export interface ListViewState {
  groupBy: 'none' | 'date' | 'priority' | 'tag';
  sortBy: { field: 'date' | 'priority' | 'title' | 'tag'; dir: 'asc' | 'desc' };
  show: 'active' | 'completed' | 'all';
  filters: PropertyFilter[];
}
```

Also add `listViewStates?: Record<string, ListViewState>;` to `CalendarSettings`:

```typescript
export interface CalendarSettings {
  desktop: ViewConfig;
  mobile: ViewConfig;
  taskPrefix: string;
  addToToday: boolean;
  customFilePath: string;
  inbox: InboxSettings;
  pinnedTags: string[];
  archivedTags: string[];
  tagGroups: TagGroup[];
  dailyNoteProvider: 'auto' | 'periodic-notes' | 'core' | 'obsidian-journal' | 'manual';
  manualDailyNotePath: string;
  taskInsertionMode: 'append' | 'section';
  taskInsertionSection: string;
  sourceNoteDisplay: 'never' | 'always' | 'non-default';
  listViewStates?: Record<string, ListViewState>;
}
```

Note: the `import type { TaskPriority }` needs to be at the top of the file (add to existing imports, not inline).

- [ ] **Step 2: Add `getListViewDefaults` to `src/settings/defaults.ts`**

**IMPORTANT: Do NOT import from `../app/AppState` — that creates a circular dependency (AppState imports getListViewDefaults from defaults). The function takes a plain `string`, not `ListSelection`.**

Add to `src/settings/defaults.ts`:

```typescript
import type { ListViewState } from './types';

export function getListViewDefaults(listKey: string): ListViewState {
  const useDateGrouping = listKey === 'today' || listKey === 'upcoming';
  return {
    groupBy: useDateGrouping ? 'date' : 'none',
    sortBy: { field: 'date', dir: 'asc' },
    show: 'active',
    filters: [],
  };
}
```

`listSelectionToKey` is a module-level function in `CenterPanel.ts` (not in defaults.ts) — added in Task 5.

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
npm run test:unit
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/settings/types.ts src/settings/defaults.ts
git commit -m "feat(types): add ListViewState, PropertyFilter, listViewStates settings field"
```

---

### Task 2: Add `centerListViewState` to AppState

**Files:**
- Modify: `src/app/AppState.ts`
- Modify: `test/app-state.test.ts`

**Interfaces:**
- Consumes: `ListViewState` from `src/settings/types.ts`, `getListViewDefaults` from `src/settings/defaults.ts`
- Produces: `AppState.get('centerListViewState')`, `AppState.set('centerListViewState', ...)`

- [ ] **Step 1: Write a failing test in `test/app-state.test.ts`**

Add inside the existing `describe('AppState', ...)` block. **No import of `getListViewDefaults` needed — just assert the shape directly.**

```typescript
it('centerListViewState defaults to today defaults', () => {
  const s = new AppState();
  const state = s.get('centerListViewState');
  expect(state.groupBy).toBe('date');
  expect(state.sortBy).toEqual({ field: 'date', dir: 'asc' });
  expect(state.show).toBe('active');
  expect(state.filters).toEqual([]);
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm run test:unit -- test/app-state.test.ts
```

Expected: FAIL — `centerListViewState` not a key on `AppStateData`.

- [ ] **Step 3: Add to `src/app/AppState.ts`**

```typescript
import { getListViewDefaults } from '../settings/defaults';
import type { ListViewState } from '../settings/types';

export interface AppStateData {
  mode: ViewMode;
  selectedList: ListSelection;
  taskStack: Array<Task | SubTask>;
  centerFilter: string;
  searchQuery: string;
  draggingTask: Task | null;
  draggingTag: string | null;
  centerListViewState: ListViewState;
}

// In the class, update the initial `data`:
private data: AppStateData = {
  mode: 'tasks',
  selectedList: 'today',
  taskStack: [],
  centerFilter: '',
  searchQuery: '',
  draggingTask: null,
  draggingTag: null,
  centerListViewState: getListViewDefaults('today'),
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:unit -- test/app-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/AppState.ts test/app-state.test.ts
git commit -m "feat(state): add centerListViewState to AppState"
```

---

### Task 3: Extend `taskGrouping.ts` with sort-by-field and group-by functions

**Files:**
- Modify: `src/views/taskGrouping.ts`
- Modify: `test/task-grouping.test.ts`

**Interfaces:**
- Produces:
  - `sortTasksByField(tasks, field, dir): Task[]`
  - `groupTasksByDate(tasks): Array<{ label: string; tasks: Task[] }>` (extracts existing CenterPanel logic)
  - `groupTasksByPriority(tasks): Array<{ label: string; tasks: Task[] }>`
  - `groupTasksByTag(tasks): Array<{ label: string; tasks: Task[] }>`

- [ ] **Step 1: Write failing tests in `test/task-grouping.test.ts`**

Add after the existing describe blocks:

```typescript
import {
  sortTasksByField,
  groupTasksByDate,
  groupTasksByPriority,
  groupTasksByTag,
} from '../src/views/taskGrouping';

describe('sortTasksByField', () => {
  it('date asc: nearest first (no date sorts last)', () => {
    const t1 = task({ due: '2026-07-01' });
    const t2 = task({ due: '2026-06-28' });
    const t3 = task({});
    const out = sortTasksByField([t1, t3, t2], 'date', 'asc');
    expect(out.map((t) => t.due)).toEqual(['2026-06-28', '2026-07-01', undefined]);
  });

  it('date desc: furthest first, no-date last', () => {
    const t1 = task({ due: '2026-07-01' });
    const t2 = task({ due: '2026-06-28' });
    const out = sortTasksByField([t2, t1], 'date', 'desc');
    expect(out[0]?.due).toBe('2026-07-01');
  });

  it('priority asc: A before F', () => {
    const out = sortTasksByField(
      [task({ priority: 'F' }), task({ priority: 'A' })],
      'priority',
      'asc',
    );
    expect(out[0]?.priority).toBe('A');
  });

  it('priority desc: F before A', () => {
    const out = sortTasksByField(
      [task({ priority: 'A' }), task({ priority: 'F' })],
      'priority',
      'desc',
    );
    expect(out[0]?.priority).toBe('F');
  });

  it('title asc: alphabetical', () => {
    const out = sortTasksByField(
      [task({ text: 'zebra' }), task({ text: 'apple' })],
      'title',
      'asc',
    );
    expect(out[0]?.text).toBe('apple');
  });

  it('tag asc: first tag alphabetical, untagged last', () => {
    const t1 = task({ rawText: '- [ ] task #work' });
    const t2 = task({ rawText: '- [ ] task #art' });
    const t3 = task({ rawText: '- [ ] task no tag' });
    const out = sortTasksByField([t1, t3, t2], 'tag', 'asc');
    expect((out[0]?.rawText.match(/#[\w/-]+/u) ?? [])[0]).toBe('#art');
    expect(out[2]?.rawText).toContain('no tag');
  });
});

describe('groupTasksByPriority', () => {
  it('returns groups for present priorities only', () => {
    const tasks = [
      task({ priority: 'A', text: 'high' }),
      task({ priority: 'D', text: 'normal' }),
    ];
    const groups = groupTasksByPriority(tasks);
    expect(groups.map((g) => g.label)).toContain('🔺 Highest');
    expect(groups.map((g) => g.label)).toContain('Normal');
    expect(groups.map((g) => g.label)).not.toContain('⏬ Lowest');
  });

  it('tasks with priority A appear in Highest group', () => {
    const t = task({ priority: 'A', text: 'urgent' });
    const groups = groupTasksByPriority([t]);
    const highest = groups.find((g) => g.label === '🔺 Highest');
    expect(highest?.tasks[0]?.text).toBe('urgent');
  });
});

describe('groupTasksByTag', () => {
  it('groups by first tag; untagged go to "No tag"', () => {
    const t1 = task({ rawText: '- [ ] a #work' });
    const t2 = task({ rawText: '- [ ] b #personal' });
    const t3 = task({ rawText: '- [ ] c no tag' });
    const groups = groupTasksByTag([t1, t2, t3]);
    expect(groups.map((g) => g.label)).toContain('#work');
    expect(groups.map((g) => g.label)).toContain('#personal');
    expect(groups.map((g) => g.label)).toContain('No tag');
  });
});

describe('groupTasksByDate', () => {
  it('returns Overdue group for tasks with past due date', () => {
    const t = task({ due: '2020-01-01' });
    const groups = groupTasksByDate([t], '2026-06-26', '2026-06-27');
    expect(groups[0]?.label).toBe('Overdue');
    expect(groups[0]?.tasks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm run test:unit -- test/task-grouping.test.ts
```

Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement in `src/views/taskGrouping.ts`**

Add these exports:

```typescript
const PRIORITY_LABELS: Record<string, string> = {
  A: '🔺 Highest',
  B: '⏫ High',
  C: '🔼 Medium',
  D: 'Normal',
  E: '🔽 Low',
  F: '⏬ Lowest',
};

export function sortTasksByField(
  tasks: Task[],
  field: 'date' | 'priority' | 'title' | 'tag',
  dir: 'asc' | 'desc',
): Task[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    let cmp = 0;
    if (field === 'date') {
      const da = a.due ?? a.scheduled ?? a.dailyNoteDate ?? '';
      const db = b.due ?? b.scheduled ?? b.dailyNoteDate ?? '';
      if (!da && !db) cmp = 0;
      else if (!da) cmp = 1;
      else if (!db) cmp = -1;
      else cmp = da < db ? -1 : da > db ? 1 : 0;
      if (cmp === 0) {
        const ta = a.time ?? '';
        const tb = b.time ?? '';
        if (ta && !tb) cmp = -1;
        else if (!ta && tb) cmp = 1;
        else cmp = ta < tb ? -1 : ta > tb ? 1 : 0;
      }
    } else if (field === 'priority') {
      cmp = a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0;
    } else if (field === 'title') {
      cmp = a.text.localeCompare(b.text);
    } else {
      const ta = (a.rawText.match(/#[\w/-]+/u) ?? [])[0] ?? '';
      const tb = (b.rawText.match(/#[\w/-]+/u) ?? [])[0] ?? '';
      if (!ta && !tb) cmp = 0;
      else if (!ta) cmp = 1;
      else if (!tb) cmp = -1;
      else cmp = ta.localeCompare(tb);
    }
    return cmp * sign;
  });
}

export function groupTasksByPriority(tasks: Task[]): Array<{ label: string; tasks: Task[] }> {
  const PRIORITY_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.priority ?? 'D';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return PRIORITY_ORDER.filter((p) => map.has(p)).map((p) => ({
    label: PRIORITY_LABELS[p] ?? p,
    tasks: map.get(p)!,
  }));
}

export function groupTasksByTag(tasks: Task[]): Array<{ label: string; tasks: Task[] }> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const tag = (t.rawText.match(/#[\w/-]+/u) ?? [])[0] ?? '';
    const key = tag || 'No tag';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const groups: Array<{ label: string; tasks: Task[] }> = [];
  for (const [label, gtasks] of map) {
    if (label !== 'No tag') groups.push({ label, tasks: gtasks });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));
  if (map.has('No tag')) groups.push({ label: 'No tag', tasks: map.get('No tag')! });
  return groups;
}

export function groupTasksByDate(
  tasks: Task[],
  today: string,
  tomorrow: string,
): Array<{ label: string; tasks: Task[] }> {
  const overdue: Task[] = [];
  const todayTasks: Task[] = [];
  const tomorrowTasks: Task[] = [];
  const upcoming: Task[] = [];

  for (const t of tasks) {
    const d = t.due ?? t.scheduled ?? t.dailyNoteDate;
    if (!d || d < today) overdue.push(t);
    else if (d === today) todayTasks.push(t);
    else if (d === tomorrow) tomorrowTasks.push(t);
    else upcoming.push(t);
  }

  const result: Array<{ label: string; tasks: Task[] }> = [];
  if (overdue.length) result.push({ label: 'Overdue', tasks: overdue });
  if (todayTasks.length) result.push({ label: 'Today', tasks: todayTasks });
  if (tomorrowTasks.length) result.push({ label: 'Tomorrow', tasks: tomorrowTasks });
  if (upcoming.length) result.push({ label: 'Upcoming', tasks: upcoming });
  return result;
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- test/task-grouping.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/views/taskGrouping.ts test/task-grouping.test.ts
git commit -m "feat(grouping): add sortTasksByField, groupTasksByPriority/Tag/Date"
```

---

### Task 4: Update `sourceNoteChip.ts` to accept click callback

**Files:**
- Modify: `src/ui/sourceNoteChip.ts`
- Modify: `test/source-note-chip.test.ts`

**Interfaces:**
- Produces: `renderSourceNoteChip(container, task, onClick?: (filePath: string) => void): void`

- [ ] **Step 1: Write a failing test in `test/source-note-chip.test.ts`**

Add:

```typescript
it('calls onClick with filePath when chip is clicked', () => {
  const container = document.createElement('div');
  const t = /* existing task helper */ task({ filePath: 'notes/2026-06-26.md' });
  const cb = vi.fn();
  renderSourceNoteChip(container, t, cb);
  const chip = container.querySelector('.tc-task-source-note') as HTMLElement;
  chip.click();
  expect(cb).toHaveBeenCalledWith('notes/2026-06-26.md');
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm run test:unit -- test/source-note-chip.test.ts
```

- [ ] **Step 3: Update `src/ui/sourceNoteChip.ts`**

```typescript
import { setIcon } from 'obsidian';
import type { Task } from '../parser/types';

export function shouldShowSourceNote(
  task: Task,
  sourceNoteDisplay: 'never' | 'always' | 'non-default',
  customFilePath: string,
): boolean {
  if (sourceNoteDisplay === 'never') return false;
  if (sourceNoteDisplay === 'always') return true;
  const isDefault =
    task.dailyNoteDate !== undefined || (customFilePath !== '' && task.filePath === customFilePath);
  return !isDefault;
}

export function renderSourceNoteChip(
  container: HTMLElement,
  task: Task,
  onClick?: (filePath: string) => void,
): void {
  const noteName = task.filePath.split('/').pop()?.replace(/\.md$/, '') ?? '';
  const chip = container.createEl('span', {
    cls: `tc-task-source-note${onClick ? ' tc-task-source-note--clickable' : ''}`,
  });
  const iconEl = chip.createEl('span', { cls: 'tc-task-source-note-icon' });
  setIcon(iconEl, 'file-text');
  chip.createEl('span', { cls: 'tc-task-source-note-name', text: noteName });
  if (onClick) {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(task.filePath);
    });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- test/source-note-chip.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/sourceNoteChip.ts test/source-note-chip.test.ts
git commit -m "feat(chip): add optional onClick callback to renderSourceNoteChip"
```

---

### Task 5: CenterPanel — per-list state management

This task wires per-list state persistence: saving state on list switch, loading on switch, and the `onSaveSettings` callback.

**Files:**
- Modify: `src/panels/CenterPanel.ts` (constructor + `mount()` changes only)
- Modify: `src/views/PanelView.ts`
- Modify: `src/main.ts`
- Test: `test/center-panel-helpers.test.ts` (no constructor call changes needed — `onSaveSettings` defaults to no-op)

**Interfaces:**
- Consumes: `getListViewDefaults`, `listSelectionToKey` from `settings/defaults.ts`; `ListViewState` from `settings/types.ts`
- Produces: `CenterPanel` with optional 6th param `onSaveSettings: () => Promise<void>`

- [ ] **Step 1: Write a failing test in `test/center-panel-helpers.test.ts`**

Add a describe block for state switching:

```typescript
describe('per-list state management', () => {
  it('loads default state for today list on mount', () => {
    const { state } = makePanel([]);
    const vs = state.get('centerListViewState');
    expect(vs.groupBy).toBe('date');
    expect(vs.show).toBe('active');
  });

  it('switches to inbox defaults when selectedList changes to inbox', () => {
    const { state } = makePanel([]);
    state.set('selectedList', 'inbox');
    const vs = state.get('centerListViewState');
    expect(vs.groupBy).toBe('none');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm run test:unit -- test/center-panel-helpers.test.ts
```

Expected: FAIL — state not updated on list change.

- [ ] **Step 3: Update `CenterPanel` constructor and `mount()`**

Add to the top of `src/panels/CenterPanel.ts`:

```typescript
import { getListViewDefaults } from '../settings/defaults';
import type { ListSelection } from '../app/AppState';
import type { ListViewState } from '../settings/types';
```

Add this module-level helper function right after the imports (before the `class CenterPanel` declaration). This avoids a circular import that would occur if it were in `defaults.ts`:

```typescript
function listSelectionToKey(sel: ListSelection): string {
  if (typeof sel === 'string') return sel;
  if (sel.type === 'tag') return `tag:${sel.tag}`;
  return `group:${sel.groupId}`;
}
```

Change the class to add:
```typescript
private currentListKey: string = 'today';
private onSaveSettings: () => Promise<void>;
```

Update the constructor signature (add 6th optional param):
```typescript
constructor(
  private state: AppState,
  private store: TaskStore,
  private app: App,
  private settings: CalendarSettings,
  private tagManager: TagManager,
  onSaveSettings: () => Promise<void> = async () => {},
) {
  this.onSaveSettings = onSaveSettings;
}
```

In `mount()`, update the `selectedList` listener:

```typescript
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
    this.render();
  }),
  // ... keep existing listeners for mode, centerFilter, searchQuery, taskStack
```

Also, add `this.state.on('centerListViewState', () => this.render())` to the listeners in `mount()`.

In `mount()` before `this.render()`, initialize the key and state:
```typescript
const initialKey = listSelectionToKey(this.state.get('selectedList'));
this.currentListKey = initialKey;
const initialVs =
  this.settings.listViewStates?.[initialKey] ?? getListViewDefaults(initialKey);
this.state.set('centerListViewState', initialVs);
```

- [ ] **Step 4: Update `src/views/PanelView.ts`**

Add `onSaveSettings: () => Promise<void>` to the constructor and pass it to CenterPanel:

```typescript
constructor(
  leaf: WorkspaceLeaf,
  private store: TaskStore,
  private settings: CalendarSettings,
  private tagManager: TagManager,
  private onSaveSettings: () => Promise<void> = async () => {},
) {
  super(leaf);
}
```

Change the CenterPanel instantiation line:
```typescript
this.center = new CenterPanel(
  this.state, this.store, this.app, this.settings, this.tagManager, this.onSaveSettings,
);
```

- [ ] **Step 5: Update `src/main.ts`**

Change the `registerView` call to pass `saveSettings`:

```typescript
this.registerView(
  PANEL_VIEW_TYPE,
  (leaf) => new PanelView(leaf, this.store, this.settings, this.tagManager, () => this.saveSettings()),
);
```

- [ ] **Step 6: Run tests**

```bash
npm run test:unit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/panels/CenterPanel.ts src/views/PanelView.ts src/main.ts test/center-panel-helpers.test.ts
git commit -m "feat(center): per-list state management with persistence"
```

---

### Task 6: CenterPanel — header layout, `[↕]` button, and dropdown popover

**Files:**
- Modify: `src/panels/CenterPanel.ts` — `render()` header section + `showViewStatePopover()`

**Interfaces:**
- Consumes: `centerListViewState` from AppState
- Produces: header with `[↕]` button opening Group by / Sort by / Show popover; updates `centerListViewState` on selection

- [ ] **Step 1: Replace the header section inside `render()` in `CenterPanel.ts`**

Find and replace the header block in `render()` (lines ~137–146 in current code):

**Old:**
```typescript
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
```

**New:**
```typescript
// Header: title + right-aligned [chips] [↕] [search]
const header = this.el.createDiv({ cls: 'tc-center-header' });
header.createEl('h2', { cls: 'tc-center-title', text: this.getTitle() });

const controls = header.createDiv({ cls: 'tc-center-controls' });
this.renderPropertyChips(controls);
this.renderViewStateButton(controls);

const searchInput = controls.createEl('input', {
  cls: 'tc-center-search',
  attr: { type: 'text', placeholder: 'Filter…' },
});
searchInput.value = this.state.get('centerFilter');
searchInput.addEventListener('input', () => {
  this.state.set('centerFilter', searchInput.value);
});
```

- [ ] **Step 2: Add `renderPropertyChips()` method**

Add as a private method:

```typescript
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
  const PRIORITY_EMOJIS: Record<string, string> = {
    A: '🔺 Highest', B: '⏫ High', C: '🔼 Medium', D: 'Normal', E: '🔽 Low', F: '⏬ Lowest',
  };
  return PRIORITY_EMOJIS[f.value] ?? f.value;
}

private addPropertyFilter(filter: PropertyFilter): void {
  const vs = this.state.get('centerListViewState');
  const already = vs.filters.some((f) => {
    if (f.type !== filter.type) return false;
    if (f.type === 'file' && filter.type === 'file') return f.filePath === filter.filePath;
    if (f.type === 'tag' && filter.type === 'tag') return f.value === filter.value;
    if (f.type === 'time' && filter.type === 'time') return f.value === filter.value;
    if (f.type === 'priority' && filter.type === 'priority') return f.value === filter.value;
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
```

Add the import at the top:
```typescript
import type { ListViewState, PropertyFilter } from '../settings/types';
```

- [ ] **Step 3: Add `renderViewStateButton()` and `showViewStatePopover()` methods**

```typescript
private renderViewStateButton(container: HTMLElement): void {
  const vs = this.state.get('centerListViewState');
  const defaults = getListViewDefaults(this.currentListKey);
  const isNonDefault =
    vs.groupBy !== defaults.groupBy ||
    vs.sortBy.field !== defaults.sortBy.field ||
    vs.sortBy.dir !== defaults.sortBy.dir ||
    vs.show !== defaults.show ||
    vs.filters.length > 0;

  const btn = container.createEl('button', {
    cls: `tc-view-state-btn${isNonDefault ? ' tc-view-state-btn--active' : ''}`,
    attr: { 'aria-label': 'Sort & group options' },
  });
  setIcon(btn, 'arrow-up-down');
  btn.addEventListener('click', () => this.showViewStatePopover(btn));
}

private showViewStatePopover(anchor: HTMLElement): void {
  const existing = this.el.querySelector('.tc-view-state-popover');
  if (existing) { existing.remove(); return; }

  const vs = this.state.get('centerListViewState');
  const popover = this.el.createDiv({ cls: 'tc-view-state-popover tc-popover' });

  const makeRow = (
    icon: string,
    label: string,
    currentValue: string,
    options: Array<{ label: string; value: string }>,
    onSelect: (value: string) => void,
  ): void => {
    const row = popover.createDiv({ cls: 'tc-view-state-row' });
    const rowMain = row.createDiv({ cls: 'tc-view-state-row-main' });
    const iconEl = rowMain.createEl('span', { cls: 'tc-view-state-row-icon' });
    setIcon(iconEl, icon);
    rowMain.createEl('span', { cls: 'tc-view-state-row-label', text: label });
    const valEl = rowMain.createEl('span', { cls: 'tc-view-state-row-value', text: currentValue });
    const chevEl = rowMain.createEl('span', { cls: 'tc-view-state-row-chevron' });
    setIcon(chevEl, 'chevron-right');

    const subList = row.createDiv({ cls: 'tc-view-state-sublist' });
    subList.style.display = 'none';

    rowMain.addEventListener('click', () => {
      const isOpen = subList.style.display !== 'none';
      popover.querySelectorAll<HTMLElement>('.tc-view-state-sublist').forEach((el) => {
        el.style.display = 'none';
      });
      if (!isOpen) subList.style.display = '';
    });

    for (const opt of options) {
      const optEl = subList.createEl('button', { cls: 'tc-view-state-option', text: opt.label });
      if (opt.value === currentValue || opt.label === currentValue) optEl.addClass('is-active');
      optEl.addEventListener('click', () => {
        onSelect(opt.value);
        popover.remove();
      });
    }
  };

  const GROUP_BY_OPTIONS = [
    { label: 'None', value: 'none' },
    { label: 'Date', value: 'date' },
    { label: 'Priority', value: 'priority' },
    { label: 'Tag', value: 'tag' },
  ];
  const GROUP_LABELS: Record<string, string> = { none: 'None', date: 'Date', priority: 'Priority', tag: 'Tag' };

  const SORT_BY_OPTIONS = [
    { label: `Date ${vs.sortBy.field === 'date' ? (vs.sortBy.dir === 'asc' ? '↑' : '↓') : ''}`.trim(), value: 'date' },
    { label: `Priority ${vs.sortBy.field === 'priority' ? (vs.sortBy.dir === 'asc' ? '↑' : '↓') : ''}`.trim(), value: 'priority' },
    { label: `Title ${vs.sortBy.field === 'title' ? (vs.sortBy.dir === 'asc' ? '↑' : '↓') : ''}`.trim(), value: 'title' },
    { label: `Tag ${vs.sortBy.field === 'tag' ? (vs.sortBy.dir === 'asc' ? '↑' : '↓') : ''}`.trim(), value: 'tag' },
  ];
  const sortLabel = `${vs.sortBy.field.charAt(0).toUpperCase() + vs.sortBy.field.slice(1)} ${vs.sortBy.dir === 'asc' ? '↑' : '↓'}`;

  const SHOW_OPTIONS = [
    { label: 'Active only', value: 'active' },
    { label: 'Completed only', value: 'completed' },
    { label: 'All', value: 'all' },
  ];
  const SHOW_LABELS: Record<string, string> = { active: 'Active', completed: 'Completed', all: 'All' };

  makeRow('layout-list', 'Group by', GROUP_LABELS[vs.groupBy] ?? vs.groupBy, GROUP_BY_OPTIONS, (val) => {
    this.updateViewState({ ...vs, groupBy: val as ListViewState['groupBy'] });
  });

  makeRow('arrow-up-down', 'Sort by', sortLabel, SORT_BY_OPTIONS, (val) => {
    const field = val as ListViewState['sortBy']['field'];
    const dir: 'asc' | 'desc' =
      vs.sortBy.field === field && vs.sortBy.dir === 'asc' ? 'desc' : 'asc';
    this.updateViewState({ ...vs, sortBy: { field, dir } });
  });

  makeRow('eye', 'Show', SHOW_LABELS[vs.show] ?? vs.show, SHOW_OPTIONS, (val) => {
    this.updateViewState({ ...vs, show: val as ListViewState['show'] });
  });

  anchor.after(popover);
  window.setTimeout(() => {
    const dismiss = (e: MouseEvent): void => {
      if (!popover.contains(e.target as Node) && e.target !== anchor) {
        popover.remove();
        activeDocument.removeEventListener('click', dismiss, true);
      }
    };
    activeDocument.addEventListener('click', dismiss, true);
  }, 0);
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:unit
```

Expected: all pass (no tests directly cover the popover DOM — that's tested visually in Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/panels/CenterPanel.ts
git commit -m "feat(center): add [↕] sort/group/show dropdown and filter chips"
```

---

### Task 7: CenterPanel — update `getFilteredTasks()` and rendering pipeline

**Files:**
- Modify: `src/panels/CenterPanel.ts`
- Modify: `test/center-panel-helpers.test.ts` (add grouping tests)

**Interfaces:**
- Consumes: `sortTasksByField`, `groupTasksByDate`, `groupTasksByPriority`, `groupTasksByTag` from `taskGrouping.ts`
- Consumes: `centerListViewState` from AppState

- [ ] **Step 1: Write failing tests**

Add to `test/center-panel-helpers.test.ts`:

```typescript
describe('getFilteredTasks respects show status', () => {
  it('show=active excludes done tasks', () => {
    const { panel, state } = makePanel([
      task({ text: 'open', status: 'open' }),
      task({ text: 'done', status: 'done' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none', sortBy: { field: 'date', dir: 'asc' }, show: 'active', filters: [],
    });
    state.set('selectedList', 'inbox');
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks.every((t) => t.status !== 'done')).toBe(true);
  });

  it('show=completed returns only done tasks', () => {
    const { panel, state } = makePanel([
      task({ text: 'open', status: 'open' }),
      task({ text: 'done', status: 'done' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none', sortBy: { field: 'date', dir: 'asc' }, show: 'completed', filters: [],
    });
    state.set('selectedList', 'inbox');
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks.every((t) => t.status === 'done')).toBe(true);
  });

  it('show=all returns both', () => {
    const { panel, state } = makePanel([
      task({ text: 'open', status: 'open' }),
      task({ text: 'done', status: 'done' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none', sortBy: { field: 'date', dir: 'asc' }, show: 'all', filters: [],
    });
    state.set('selectedList', 'inbox');
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks.length).toBe(2);
  });
});

describe('getFilteredTasks respects property filters', () => {
  it('tag filter keeps only tasks with matching tag', () => {
    const { panel, state } = makePanel([
      task({ rawText: '- [ ] work task #work', text: 'work task', status: 'open' }),
      task({ rawText: '- [ ] personal #personal', text: 'personal', status: 'open' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      show: 'active',
      filters: [{ type: 'tag', value: '#work' }],
    });
    state.set('selectedList', 'inbox');
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toBe('work task');
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npm run test:unit -- test/center-panel-helpers.test.ts
```

- [ ] **Step 3a: Fix `getInboxTasks()` to NOT pre-filter by status**

**CRITICAL:** `getInboxTasks()` currently starts with `this.store.getTasks().filter((t) => t.status === 'open')`. This must be removed so that `show === 'completed'` and `show === 'all'` work for the inbox list. The `getFilteredTasks()` step 2 handles status filtering for all lists.

Replace the first two lines of `getInboxTasks()`:

**Old:**
```typescript
private getInboxTasks(): Task[] {
  const { inbox } = this.settings;
  const allOpen = this.store.getTasks().filter((t) => t.status === 'open');
  const withTag =
    inbox.mode !== 'untagged' ? allOpen.filter((t) => t.rawText.includes(inbox.tag)) : [];
  const includeUntagged = inbox.mode !== 'tag' || inbox.showUntagged;
  const untagged = includeUntagged ? allOpen.filter((t) => !/#[\w/-]+/u.test(t.rawText)) : [];
```

**New:**
```typescript
private getInboxTasks(): Task[] {
  const { inbox } = this.settings;
  const all = this.store.getTasks();
  const withTag =
    inbox.mode !== 'untagged' ? all.filter((t) => t.rawText.includes(inbox.tag)) : [];
  const includeUntagged = inbox.mode !== 'tag' || inbox.showUntagged;
  const untagged = includeUntagged ? all.filter((t) => !/#[\w/-]+/u.test(t.rawText)) : [];
```

The rest of the method body stays identical.

- [ ] **Step 3b: Update `getFilteredTasks()` in `CenterPanel.ts`**

Add imports at top of file:

```typescript
import { groupTasksByDate, groupTasksByPriority, groupTasksByTag, sortTasksByField } from '../views/taskGrouping';
```

Replace the `getFilteredTasks()` method:

```typescript
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
          if (t.due === todayStr || t.scheduled === todayStr || t.dailyNoteDate === todayStr) return true;
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
  } else {
    const group = this.settings.tagGroups.find((g) => g.id === sel.groupId);
    tasks = this.store.getTasks().filter((t) => {
      if (!group) return false;
      if (group.mode === 'prefix' && group.prefix) return t.rawText.includes(`#${group.prefix}`);
      return (group.tags ?? []).some((tag) => t.rawText.includes(tag));
    });
  }

  // 2. Show status filter
  if (vs.show === 'active') {
    tasks = tasks.filter((t) => t.status === 'open' || t.status === 'in-progress');
  } else if (vs.show === 'completed') {
    tasks = tasks.filter((t) => t.status === 'done');
  }
  // 'all' → no filter

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
    }
  }

  // 4. Text filter
  if (filter) {
    tasks = tasks.filter(
      (t) => t.text.toLowerCase().includes(filter) || t.rawText.toLowerCase().includes(filter),
    );
  }

  // 5. Sort
  return sortTasksByField(tasks, vs.sortBy.field, vs.sortBy.dir);
}
```

- [ ] **Step 4: Replace `renderGrouped` / `renderFlat` calls in `render()`**

In `render()`, replace:
```typescript
const needsGrouping = sel === 'today' || sel === 'upcoming';
if (needsGrouping) {
  this.renderGrouped(scroll, tasks);
} else {
  this.renderFlat(scroll, tasks);
}
```

With:
```typescript
this.renderWithGrouping(scroll, tasks);
```

- [ ] **Step 5a: Delete the old `renderGrouped()` method from `CenterPanel.ts`**

The old `renderGrouped()` method (which hardcodes Overdue/Today/Tomorrow/Upcoming groups for date grouping) is now replaced by `renderWithGrouping()` calling `groupTasksByDate()`. Delete the entire `private renderGrouped(...)` method. The call site was already replaced in Step 4. Leaving it as dead code will fail `npm run knip`.

- [ ] **Step 5b: Add `renderWithGrouping()` method**

```typescript
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
```

- [ ] **Step 6: Update `renderSourceNoteChip` call in `renderTaskCard` to pass click callback**

Find the `renderSourceNoteChip(metaRight, task)` call and replace with:

```typescript
renderSourceNoteChip(metaRight, task, (filePath) => {
  this.addPropertyFilter({ type: 'file', filePath });
});
```

- [ ] **Step 7: Add click handlers on tag spans and time spans in `renderTaskCard`**

In the tag rendering loop (inside `for (const tag of tags.slice(0, 2))`), after `tagEl` is created, add:

```typescript
tagEl.addEventListener('click', (e) => {
  e.stopPropagation();
  this.addPropertyFilter({ type: 'tag', value: tag });
});
tagEl.style.cursor = 'pointer';
```

After the time span (`timeEl`) is created in both the date+time branch and the time-only branch, add:

```typescript
// In the date+time block, after clockIcon/time span creation, add to dateEl:
dateEl.addEventListener('click', (e) => {
  if (!task.time) return;
  e.stopPropagation();
  this.addPropertyFilter({ type: 'time', value: task.time });
});
```

And in the time-only block:

```typescript
timeEl.addEventListener('click', (e) => {
  e.stopPropagation();
  this.addPropertyFilter({ type: 'time', value: task.time! });
});
timeEl.style.cursor = 'pointer';
```

- [ ] **Step 8: Add "Filter by this priority" to the single-task right-click menu**

In `renderTaskCard`'s context menu section, add after the Priority submenu item:

```typescript
menu.addItem((item) =>
  item
    .setTitle('Filter by this priority')
    .setIcon('filter')
    .setSection('priority')
    .onClick(() => this.addPropertyFilter({ type: 'priority', value: task.priority })),
);
```

- [ ] **Step 9: Run tests**

```bash
npm run test:unit
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/panels/CenterPanel.ts test/center-panel-helpers.test.ts
git commit -m "feat(center): update filtering pipeline, renderWithGrouping, click-to-filter handlers"
```

---

### Task 8: CSS styles for new UI elements

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Add styles to `styles.css`**

Append at the end of the file:

```css
/* ── Center header controls ─────────────────────────────────── */
.tc-center-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tc-center-controls {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ── Property filter chips ──────────────────────────────────── */
.tc-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 10px;
  border-radius: 12px;
  background: var(--background-modifier-border);
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.tc-filter-chip-x {
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}

.tc-filter-chip-x:hover {
  color: var(--text-normal);
}

/* ── View-state (sort/group) button ─────────────────────────── */
.tc-view-state-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 6px;
  border-radius: 6px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
}

.tc-view-state-btn:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

.tc-view-state-btn--active {
  color: var(--color-accent);
}

/* ── View-state popover ─────────────────────────────────────── */
.tc-view-state-popover {
  position: absolute;
  right: 0;
  z-index: 100;
  min-width: 220px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.tc-view-state-row {
  border-bottom: 1px solid var(--background-modifier-border-hover);
}

.tc-view-state-row:last-child {
  border-bottom: none;
}

.tc-view-state-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
}

.tc-view-state-row-main:hover {
  background: var(--background-modifier-hover);
}

.tc-view-state-row-icon {
  display: flex;
  opacity: 0.7;
}

.tc-view-state-row-label {
  flex: 1;
  font-size: 13px;
}

.tc-view-state-row-value {
  font-size: 12px;
  color: var(--text-muted);
}

.tc-view-state-row-chevron {
  display: flex;
  color: var(--text-faint);
}

.tc-view-state-sublist {
  padding: 4px 0;
  background: var(--background-primary);
}

.tc-view-state-option {
  display: block;
  width: 100%;
  padding: 8px 20px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-normal);
}

.tc-view-state-option:hover {
  background: var(--background-modifier-hover);
}

.tc-view-state-option.is-active {
  color: var(--color-accent);
  font-weight: 500;
}

/* ── Source note chip — clickable variant ────────────────────── */
.tc-task-source-note--clickable {
  cursor: pointer;
}

.tc-task-source-note--clickable:hover {
  text-decoration: underline;
}

/* ── Task tag clickable ──────────────────────────────────────── */
.tc-task-tag {
  cursor: pointer;
}
```

- [ ] **Step 2: Run tests and build**

```bash
npm run test:unit && npm run build
```

Expected: all pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style: add chips, view-state dropdown, and clickable-tag styles"
```

---

### Task 9: Build, reload Obsidian, and screenshot-verify

**Goal:** Confirm the full feature works visually in the live Obsidian vault.

- [ ] **Step 1: Start dev build watcher (if not running)**

```bash
npm run dev
```

- [ ] **Step 2: Reload the plugin**

```bash
obsidian vault="dev-vault" plugin:reload id=task-calendar
```

Expected: no errors in console.

- [ ] **Step 3: Take a screenshot of the default state**

```bash
obsidian vault="dev-vault" dev:screenshot path=screenshot-default.png
```

Confirm in the screenshot:
- CenterPanel header shows title + search input
- `[↕]` button visible to the left of search

- [ ] **Step 4: Verify DOM structure of header**

```bash
obsidian vault="dev-vault" dev:dom selector=".tc-center-header" text
```

Expected output contains: `tc-center-controls`, `tc-view-state-btn`, `tc-center-search`.

- [ ] **Step 5: Open dropdown via eval and screenshot**

```bash
obsidian vault="dev-vault" eval code="document.querySelector('.tc-view-state-btn')?.click()"
obsidian vault="dev-vault" dev:screenshot path=screenshot-dropdown.png
```

Confirm: popover visible with Group by / Sort by / Show rows.

- [ ] **Step 6: Verify a filter chip appears after clicking a tag**

```bash
obsidian vault="dev-vault" eval code="document.querySelector('.tc-task-tag')?.click()"
obsidian vault="dev-vault" dev:screenshot path=screenshot-chip.png
```

Confirm: chip with tag text and × appears in header.

- [ ] **Step 7: Verify list switch clears chip and restores state**

```bash
obsidian vault="dev-vault" eval code="document.querySelector('.tc-left-item')?.click()"
obsidian vault="dev-vault" dev:screenshot path=screenshot-switched.png
```

Confirm: chips are gone after switching list.

- [ ] **Step 8: Run full test suite and lint**

```bash
npm run test:unit && npm run lint
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add screenshot-default.png screenshot-dropdown.png screenshot-chip.png screenshot-switched.png
git commit -m "test: add verification screenshots for sort/group/filter feature"
```

---

## Self-Review Checklist (run by sub-agent after all tasks complete)

A sub-agent should perform the following checks independently:

1. **Spec coverage:** Each spec section maps to a task — types (T1), AppState (T2), sort/group (T3), chip click (T4), state management (T5), dropdown (T6), filtering pipeline (T7), styles (T8), verification (T9).
2. **Type consistency:** `PropertyFilter`, `ListViewState` defined in T1 and used identically in T2–T7.
3. **No placeholders:** All steps contain actual code.
4. **Constructor compatibility:** `onSaveSettings` defaulted to no-op → existing tests unchanged.
5. **`getInboxTasks`** no longer has a status guard — status filtering now done in `getFilteredTasks` step 2. Verify `getInboxTasks` does NOT filter by `status === 'open'` (that would conflict with `show === 'all'`).
6. **`renderGrouped`** private method in `CenterPanel` — confirm it's still present (used by `renderWithGrouping` as `renderFlat` for `groupBy === 'none'`) or removed. Plan calls both `renderGrouped` (kept) and `renderFlat` — `renderGrouped` is replaced by `renderWithGrouping`. The old `renderGrouped` can be deleted.
