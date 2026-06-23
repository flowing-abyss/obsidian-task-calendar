# TickTick-like Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the obsidian-task-calendar plugin into a four-panel productivity UI (Rail + Left + Center + Right) with smart lists, configurable tag groups, task detail editing with sub-tasks and comments, and Calendar/Search modes.

**Architecture:** `AppState` is a typed event bus owned by `PanelView`. Four panel classes (`RailPanel`, `LeftPanel`, `CenterPanel`, `RightPanel`) each subscribe to the fields they need and re-render only when those fields change. All file writes go through the existing `vault.process()` pattern already in `TaskStore`.

**Tech Stack:** TypeScript (strict), Obsidian Plugin API, vanilla DOM, Vitest for tests, esbuild for bundling. No UI frameworks.

## Global Constraints

- All new files use strict TypeScript — no `any` unless absolutely necessary (cast via `unknown` first)
- Use `activeDocument` instead of `document` (Obsidian lint rule for popout window compat)
- Conventional commit messages (`feat:`, `fix:`, `refactor:`, `test:`, `style:`)
- Run `npm run build` (which runs `tsc -noEmit` + esbuild) before every commit — it must pass
- Run `npm run test:unit` before every commit — tests must pass
- After each task that touches UI: reload plugin with `obsidian plugin:reload id=task-calendar` and take `obsidian dev:screenshot path=screenshot.png` to verify visually
- The dev vault is at `dev-vault/` in repo root; plugin is symlinked there

---

## File Map

**New files:**
- `src/parser/SubItemParser.ts` — pure function, parses sub-items from line array
- `src/app/AppState.ts` — typed event bus, source of truth for panel state
- `src/panels/RailPanel.ts` — 48px mode icon strip
- `src/panels/LeftPanel.ts` — Inbox/Today/Upcoming + tag groups
- `src/panels/CenterPanel.ts` — filtered task list + local search
- `src/panels/RightPanel.ts` — task detail, chips, sub-tasks, comments, drill-down
- `test/subitem-parser.test.ts` — unit tests for SubItemParser
- `test/app-state.test.ts` — unit tests for AppState

**Modified files:**
- `src/parser/types.ts` — add SubTask, TaskComment, extend Task
- `src/store/TaskStore.ts` — call SubItemParser after parseTask
- `src/settings/types.ts` — add TagGroup, inboxMode to CalendarSettings
- `src/settings/defaults.ts` — add tagGroups: [], inboxMode defaults
- `src/settings/SettingsTab.ts` — add tag group management UI section
- `src/views/PanelView.ts` — full refactor: four-panel DOM, panel orchestration
- `styles.css` — add all `.tc-*` layout and component styles (keep existing `.tasksCalendar` styles)

---

## Task 1: Extend Types + SubItemParser

**Files:**
- Modify: `src/parser/types.ts`
- Create: `src/parser/SubItemParser.ts`
- Create: `test/subitem-parser.test.ts`

**Interfaces:**
- Produces: `SubTask`, `TaskComment` types; `parseSubItems(lines, taskLineIdx, filePath)` function

- [ ] **Step 1: Extend `src/parser/types.ts`**

Add after the existing `TaskFilter` interface:

```typescript
export interface SubTask {
  filePath: string;
  line: number;
  text: string;
  status: 'open' | 'done';
  subtasks?: SubTask[];
  comments?: TaskComment[];
  description?: string;
  subtaskRange?: { from: number; to: number };
}

export interface TaskComment {
  line: number;
  date?: string; // YYYY-MM-DD
  text: string;
}
```

Add to the `Task` interface (after `priority`):
```typescript
  subtasks?: SubTask[];
  comments?: TaskComment[];
  description?: string;
  subtaskRange?: { from: number; to: number };
```

- [ ] **Step 2: Write failing tests in `test/subitem-parser.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { parseSubItems } from '../src/parser/SubItemParser';

const FILE = 'test.md';

describe('parseSubItems', () => {
  it('returns empty result for task with no children', () => {
    const lines = ['- [ ] Task'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toEqual([]);
    expect(r.comments).toEqual([]);
    expect(r.description).toBe('');
    expect(r.subtaskRange).toBeUndefined();
  });

  it('parses open sub-task', () => {
    const lines = ['- [ ] Parent', '  - [ ] Child'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtasks[0]).toMatchObject({ text: 'Child', status: 'open', line: 1 });
    expect(r.subtaskRange).toEqual({ from: 1, to: 1 });
  });

  it('parses done sub-task', () => {
    const lines = ['- [ ] Parent', '  - [x] Done child'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks[0]).toMatchObject({ status: 'done' });
  });

  it('parses description line', () => {
    const lines = ['- [ ] Parent', '  - > My description'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.description).toBe('My description');
    expect(r.subtasks).toHaveLength(0);
    expect(r.comments).toHaveLength(0);
  });

  it('concatenates multiple description lines with newline', () => {
    const lines = ['- [ ] Parent', '  - > Line one', '  - > Line two'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.description).toBe('Line one\nLine two');
  });

  it('parses dated comment', () => {
    const lines = ['- [ ] Parent', '  - 2026-06-22: Some comment'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({ date: '2026-06-22', text: 'Some comment', line: 1 });
  });

  it('parses undated comment', () => {
    const lines = ['- [ ] Parent', '  - Just a comment'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.comments[0]).toMatchObject({ text: 'Just a comment', date: undefined });
  });

  it('stops at non-indented line', () => {
    const lines = ['- [ ] Parent', '  - [ ] Child', '- [ ] Sibling'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtaskRange).toEqual({ from: 1, to: 1 });
  });

  it('parses mixed children in order', () => {
    const lines = [
      '- [ ] Parent',
      '  - > Description',
      '  - [ ] Sub',
      '  - 2026-01-01: Comment',
      '  - Bare comment',
    ];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.description).toBe('Description');
    expect(r.subtasks).toHaveLength(1);
    expect(r.comments).toHaveLength(2);
    expect(r.subtaskRange).toEqual({ from: 1, to: 4 });
  });

  it('parses nested sub-tasks recursively', () => {
    const lines = [
      '- [ ] Root',
      '  - [ ] Child',
      '    - [ ] Grandchild',
    ];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtasks[0]?.subtasks).toHaveLength(1);
    expect(r.subtasks[0]?.subtasks?.[0]?.text).toBe('Grandchild');
  });

  it('sets filePath on subtasks', () => {
    const lines = ['- [ ] Parent', '  - [ ] Child'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks[0]?.filePath).toBe(FILE);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm run test:unit -- --reporter=verbose 2>&1 | head -40
```
Expected: Multiple test failures — `SubItemParser` not found.

- [ ] **Step 4: Create `src/parser/SubItemParser.ts`**

```typescript
import type { SubTask, TaskComment } from './types';

export interface SubItemResult {
  subtasks: SubTask[];
  comments: TaskComment[];
  description: string;
  subtaskRange: { from: number; to: number } | undefined;
}

const SUBTASK_RE = /^(\s*)- \[( |x|X)\]\s+(.*)/;
const DESCRIPTION_RE = /^(\s*)- > (.*)/;
const COMMENT_DATE_RE = /^(\s*)- (\d{4}-\d{2}-\d{2}):\s*(.*)/;
const COMMENT_RE = /^(\s*)- (.+)/;

export function parseSubItems(
  lines: string[],
  taskLineIdx: number,
  filePath: string,
): SubItemResult {
  const taskLine = lines[taskLineIdx] ?? '';
  const taskIndent = (taskLine.match(/^(\s*)/)?.[1] ?? '').length;

  const subtasks: SubTask[] = [];
  const comments: TaskComment[] = [];
  const descLines: string[] = [];
  let rangeFrom: number | undefined;
  let rangeTo: number | undefined;

  let i = taskLineIdx + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === '') { i++; continue; }

    const lineIndent = (line.match(/^(\s*)/)?.[1] ?? '').length;
    if (lineIndent <= taskIndent) break;

    if (rangeFrom === undefined) rangeFrom = i;
    rangeTo = i;

    const subtaskMatch = SUBTASK_RE.exec(line);
    if (subtaskMatch) {
      const statusChar = subtaskMatch[2] ?? ' ';
      const text = (subtaskMatch[3] ?? '').trim();
      const childResult = parseSubItems(lines, i, filePath);
      const subtask: SubTask = {
        filePath,
        line: i,
        text,
        status: statusChar === ' ' ? 'open' : 'done',
      };
      if (childResult.subtasks.length) subtask.subtasks = childResult.subtasks;
      if (childResult.comments.length) subtask.comments = childResult.comments;
      if (childResult.description) subtask.description = childResult.description;
      if (childResult.subtaskRange) {
        subtask.subtaskRange = childResult.subtaskRange;
        rangeTo = childResult.subtaskRange.to;
        i = childResult.subtaskRange.to + 1;
      } else {
        i++;
      }
      subtasks.push(subtask);
      continue;
    }

    const descMatch = DESCRIPTION_RE.exec(line);
    if (descMatch) {
      descLines.push((descMatch[2] ?? '').trim());
      i++;
      continue;
    }

    const commentDateMatch = COMMENT_DATE_RE.exec(line);
    if (commentDateMatch) {
      comments.push({ line: i, date: commentDateMatch[2], text: (commentDateMatch[3] ?? '').trim() });
      i++;
      continue;
    }

    const commentMatch = COMMENT_RE.exec(line);
    if (commentMatch) {
      comments.push({ line: i, text: (commentMatch[2] ?? '').trim() });
      i++;
      continue;
    }

    i++;
  }

  return {
    subtasks,
    comments,
    description: descLines.join('\n'),
    subtaskRange:
      rangeFrom !== undefined && rangeTo !== undefined
        ? { from: rangeFrom, to: rangeTo }
        : undefined,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:unit -- --reporter=verbose 2>&1 | grep -E '(PASS|FAIL|✓|✗)'
```
Expected: All SubItemParser tests pass.

- [ ] **Step 6: Build and commit**

```bash
npm run build && git add src/parser/types.ts src/parser/SubItemParser.ts test/subitem-parser.test.ts && git commit -m "feat: add SubTask/TaskComment types and SubItemParser"
```

---

## Task 2: Integrate SubItemParser into TaskStore + Create AppState

**Files:**
- Modify: `src/store/TaskStore.ts`
- Create: `src/app/AppState.ts`
- Create: `test/app-state.test.ts`

**Interfaces:**
- Consumes: `parseSubItems` from `SubItemParser.ts`; `SubTask`, `TaskComment` from `types.ts`
- Produces: `AppState` class with `get/set/on` API; Tasks now carry `subtasks`, `comments`, `description`, `subtaskRange`

- [ ] **Step 1: Integrate SubItemParser into `src/store/TaskStore.ts`**

Add import at top:
```typescript
import { parseSubItems } from '../parser/SubItemParser';
```

In `parseFileTasks`, inside the `for (const item of cache.listItems)` loop, after `tasks.push(task)` remove the push and replace the block that builds `task`:

```typescript
      if (task) {
        task.noteColor = fm?.color;
        task.noteTextColor = fm?.textColor;
        task.noteIcon = fm?.icon;
        // Parse sub-items (sub-tasks, comments, description)
        const sub = parseSubItems(lines, lineIdx, file.path ?? filePath);
        if (sub.subtasks.length) task.subtasks = sub.subtasks;
        if (sub.comments.length) task.comments = sub.comments;
        if (sub.description) task.description = sub.description;
        if (sub.subtaskRange) task.subtaskRange = sub.subtaskRange;
        tasks.push(task);
      }
```

Note: `parseFileTasks` already has `filePath` as parameter and `const lines = content.split('\n')` — those stay as-is.

- [ ] **Step 2: Write failing tests for AppState in `test/app-state.test.ts`**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';

describe('AppState', () => {
  it('returns initial values', () => {
    const s = new AppState();
    expect(s.get('mode')).toBe('tasks');
    expect(s.get('selectedList')).toBe('today');
    expect(s.get('taskStack')).toEqual([]);
    expect(s.get('centerFilter')).toBe('');
    expect(s.get('searchQuery')).toBe('');
  });

  it('set updates value', () => {
    const s = new AppState();
    s.set('mode', 'calendar');
    expect(s.get('mode')).toBe('calendar');
  });

  it('on fires listener when value changes', () => {
    const s = new AppState();
    const cb = vi.fn();
    s.on('mode', cb);
    s.set('mode', 'search');
    expect(cb).toHaveBeenCalledWith('search', 'tasks');
  });

  it('on does not fire when value is unchanged', () => {
    const s = new AppState();
    const cb = vi.fn();
    s.on('mode', cb);
    s.set('mode', 'tasks'); // same as initial
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe stops listener', () => {
    const s = new AppState();
    const cb = vi.fn();
    const off = s.on('mode', cb);
    off();
    s.set('mode', 'calendar');
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple listeners on same key all fire', () => {
    const s = new AppState();
    const a = vi.fn(); const b = vi.fn();
    s.on('centerFilter', a);
    s.on('centerFilter', b);
    s.set('centerFilter', 'hello');
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('listeners on different keys do not cross-fire', () => {
    const s = new AppState();
    const cb = vi.fn();
    s.on('searchQuery', cb);
    s.set('centerFilter', 'hello');
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm run test:unit -- test/app-state.test.ts 2>&1 | head -20
```
Expected: FAIL — `AppState` not found.

- [ ] **Step 4: Create `src/app/AppState.ts`**

```typescript
import type { Task } from '../parser/types';
import type { SubTask } from '../parser/types';

export type ViewMode = 'tasks' | 'calendar' | 'search';

export type ListSelection =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | { type: 'tag'; tag: string }
  | { type: 'group'; groupId: string };

export interface AppStateData {
  mode: ViewMode;
  selectedList: ListSelection;
  taskStack: Array<Task | SubTask>;
  centerFilter: string;
  searchQuery: string;
}

type Listener<T> = (value: T, prev: T) => void;

export class AppState {
  private data: AppStateData = {
    mode: 'tasks',
    selectedList: 'today',
    taskStack: [],
    centerFilter: '',
    searchQuery: '',
  };

  private listeners = new Map<keyof AppStateData, Set<Listener<unknown>>>();

  get<K extends keyof AppStateData>(key: K): AppStateData[K] {
    return this.data[key];
  }

  set<K extends keyof AppStateData>(key: K, value: AppStateData[K]): void {
    const prev = this.data[key];
    if (prev === value) return;
    this.data[key] = value;
    const bucket = this.listeners.get(key);
    if (bucket) {
      for (const cb of bucket) cb(value as unknown, prev as unknown);
    }
  }

  on<K extends keyof AppStateData>(key: K, listener: Listener<AppStateData[K]>): () => void {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    const bucket = this.listeners.get(key)!;
    bucket.add(listener as Listener<unknown>);
    return () => { bucket.delete(listener as Listener<unknown>); };
  }
}
```

- [ ] **Step 5: Run all tests**

```bash
npm run test:unit 2>&1 | tail -10
```
Expected: All tests pass (SubItemParser + AppState).

- [ ] **Step 6: Build and commit**

```bash
npm run build && git add src/store/TaskStore.ts src/app/AppState.ts test/app-state.test.ts && git commit -m "feat: integrate SubItemParser into TaskStore; add AppState event bus"
```

---

## Task 3: Extend Settings with Inbox Mode + Tag Groups

**Files:**
- Modify: `src/settings/types.ts`
- Modify: `src/settings/defaults.ts`
- Modify: `src/settings/SettingsTab.ts`

**Interfaces:**
- Produces: `TagGroup` type, `inboxMode`/`inboxTag`/`tagGroups` on `CalendarSettings`

- [ ] **Step 1: Extend `src/settings/types.ts`**

Add after the existing interfaces:

```typescript
export interface TagGroup {
  id: string;
  name: string;
  color?: string;
  mode: 'prefix' | 'manual';
  prefix?: string;  // prefix mode: 'work' matches #work and #work/*
  tags?: string[];  // manual mode: explicit tag list
}
```

Add to `CalendarSettings`:
```typescript
  inboxMode: 'tag' | 'untagged';
  inboxTag: string;      // e.g. '#inbox', used when inboxMode === 'tag'
  tagGroups: TagGroup[];
```

- [ ] **Step 2: Update `src/settings/defaults.ts`**

In `DEFAULT_SETTINGS`, add after `customFilePath`:
```typescript
  inboxMode: 'untagged',
  inboxTag: '#inbox',
  tagGroups: [],
```

- [ ] **Step 3: Add tag group UI to `src/settings/SettingsTab.ts`**

Add this method to `CalendarSettingsTab`:

```typescript
  private renderTagGroupSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Tag groups').setHeading();

    new Setting(containerEl)
      .setName('Inbox source')
      .setDesc('Show tasks with a specific tag, or all tasks with no tags.')
      .addDropdown((d) =>
        d
          .addOptions({ tag: 'Tag', untagged: 'Untagged tasks' })
          .setValue(this.plugin.settings.inboxMode)
          .onChange(async (v) => {
            this.plugin.settings.inboxMode = v as 'tag' | 'untagged';
            await this.plugin.saveSettings();
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            this.display();
          }),
      );

    if (this.plugin.settings.inboxMode === 'tag') {
      new Setting(containerEl)
        .setName('Inbox tag')
        .setDesc('Tasks with this tag appear in Inbox.')
        .addText((t) =>
          t
            .setPlaceholder('#inbox')
            .setValue(this.plugin.settings.inboxTag)
            .onChange(async (v) => {
              this.plugin.settings.inboxTag = v.trim();
              await this.plugin.saveSettings();
            }),
        );
    }

    // Render existing groups
    const groups = this.plugin.settings.tagGroups;
    for (let idx = 0; idx < groups.length; idx++) {
      this.renderTagGroupCard(containerEl, idx);
    }

    new Setting(containerEl).addButton((b) =>
      b
        .setButtonText('+ Add group')
        .setCta()
        .onClick(async () => {
          this.plugin.settings.tagGroups.push({
            id: `group-${Date.now()}`,
            name: 'New group',
            mode: 'prefix',
            prefix: '',
          });
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
    );
  }

  private renderTagGroupCard(containerEl: HTMLElement, idx: number): void {
    const groups = this.plugin.settings.tagGroups;
    const group = groups[idx];
    if (!group) return;

    const card = containerEl.createDiv({ cls: 'tc-settings-group-card' });

    new Setting(card)
      .setName('Group name')
      .addText((t) =>
        t.setValue(group.name).onChange(async (v) => {
          group.name = v;
          await this.plugin.saveSettings();
        }),
      )
      .addButton((b) =>
        b
          .setIcon('trash')
          .setTooltip('Delete group')
          .onClick(async () => {
            groups.splice(idx, 1);
            await this.plugin.saveSettings();
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            this.display();
          }),
      );

    new Setting(card).setName('Mode').addDropdown((d) =>
      d
        .addOptions({ prefix: 'Prefix', manual: 'Manual' })
        .setValue(group.mode)
        .onChange(async (v) => {
          group.mode = v as 'prefix' | 'manual';
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
    );

    if (group.mode === 'prefix') {
      new Setting(card)
        .setName('Prefix')
        .setDesc('e.g. "work" matches #work and #work/dev')
        .addText((t) =>
          t
            .setPlaceholder('work')
            .setValue(group.prefix ?? '')
            .onChange(async (v) => {
              group.prefix = v.trim();
              await this.plugin.saveSettings();
            }),
        );
    } else {
      new Setting(card).setName('Tags').setDesc('Comma-separated, e.g. #work, #side-project').addText(
        (t) =>
          t
            .setPlaceholder('#work, #side-project')
            .setValue((group.tags ?? []).join(', '))
            .onChange(async (v) => {
              group.tags = v
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              await this.plugin.saveSettings();
            }),
      );
    }
  }
```

In `display()`, add a call after `this.renderViewConfigSettings(containerEl, 'mobile')`:
```typescript
    this.renderTagGroupSettings(containerEl);
```

- [ ] **Step 4: Build to verify no type errors**

```bash
npm run build 2>&1 | tail -20
```
Expected: Build succeeds.

- [ ] **Step 5: Reload and spot-check settings UI**

```bash
obsidian plugin:reload id=task-calendar && sleep 1 && obsidian dev:screenshot path=screenshot-settings.png
```
Open Settings → Task calendar. Verify "Tag groups" section appears with "Inbox source" toggle and "+ Add group" button.

- [ ] **Step 6: Commit**

```bash
git add src/settings/types.ts src/settings/defaults.ts src/settings/SettingsTab.ts && git commit -m "feat: add TagGroup settings and inbox mode configuration"
```

---

## Task 4: Layout Shell — PanelView Refactor + CSS Foundation

**Files:**
- Modify: `src/views/PanelView.ts` (full rewrite)
- Modify: `styles.css` (add `.tc-*` layout styles at top, keep existing `.tasksCalendar` styles)

**Interfaces:**
- Consumes: `AppState` from `app/AppState.ts`; `TaskStore` from `store/TaskStore.ts`
- Produces: Four-column DOM structure; panel classes have `mount(el)/destroy()/refresh()` interface

- [ ] **Step 1: Add placeholder panel classes (stubs)**

Create `src/panels/RailPanel.ts`:
```typescript
import type { AppState } from '../app/AppState';

export class RailPanel {
  private el!: HTMLElement;
  constructor(private state: AppState) {}
  mount(container: HTMLElement): void {
    this.el = container;
    this.el.addClass('tc-rail');
    this.render();
  }
  destroy(): void { this.el?.empty(); }
  private render(): void {
    this.el.empty();
    this.el.createEl('span', { text: 'Rail' });
  }
}
```

Create `src/panels/LeftPanel.ts`:
```typescript
import type { App } from 'obsidian';
import type { AppState } from '../app/AppState';
import type { CalendarSettings } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';

export class LeftPanel {
  private el!: HTMLElement;
  constructor(private state: AppState, private store: TaskStore, private settings: CalendarSettings) {}
  mount(container: HTMLElement): void {
    this.el = container;
    this.render();
  }
  refresh(): void { this.render(); }
  destroy(): void { this.el?.empty(); }
  private render(): void {
    this.el.empty();
    this.el.createEl('span', { text: 'Left' });
  }
}
```

Create `src/panels/CenterPanel.ts`:
```typescript
import type { App } from 'obsidian';
import type { AppState } from '../app/AppState';
import type { TaskStore } from '../store/TaskStore';

export class CenterPanel {
  private el!: HTMLElement;
  constructor(private state: AppState, private store: TaskStore, private app: App) {}
  mount(container: HTMLElement): void {
    this.el = container;
    this.render();
  }
  refresh(): void { this.render(); }
  destroy(): void { this.el?.empty(); }
  private render(): void {
    this.el.empty();
    this.el.createEl('span', { text: 'Center' });
  }
}
```

Create `src/panels/RightPanel.ts`:
```typescript
import type { App } from 'obsidian';
import type { AppState } from '../app/AppState';
import type { TaskStore } from '../store/TaskStore';

export class RightPanel {
  private el!: HTMLElement;
  constructor(private state: AppState, private store: TaskStore, private app: App) {}
  mount(container: HTMLElement): void {
    this.el = container;
    this.render();
  }
  destroy(): void { this.el?.empty(); }
  private render(): void {
    this.el.empty();
    this.el.createEl('span', { text: 'Right' });
  }
}
```

- [ ] **Step 2: Rewrite `src/views/PanelView.ts`**

```typescript
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { AppState } from '../app/AppState';
import { CenterPanel } from '../panels/CenterPanel';
import { LeftPanel } from '../panels/LeftPanel';
import { RailPanel } from '../panels/RailPanel';
import { RightPanel } from '../panels/RightPanel';
import type { CalendarSettings } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';

export const PANEL_VIEW_TYPE = 'task-calendar-panel';

export class PanelView extends ItemView {
  private state!: AppState;
  private rail!: RailPanel;
  private left!: LeftPanel;
  private center!: CenterPanel;
  private right!: RightPanel;
  private storeUnsub?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private settings: CalendarSettings,
  ) {
    super(leaf);
  }

  getViewType(): string { return PANEL_VIEW_TYPE; }
  getDisplayText(): string { return 'Task calendar'; }
  getIcon(): string { return 'calendar-days'; }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('tc-panel-view');

    this.state = new AppState();

    const layout = this.contentEl.createDiv({ cls: 'tc-layout' });
    const railEl = layout.createDiv({ cls: 'tc-rail' });
    const leftEl = layout.createDiv({ cls: 'tc-left' });
    const centerEl = layout.createDiv({ cls: 'tc-center' });
    const rightEl = layout.createDiv({ cls: 'tc-right' });

    this.rail = new RailPanel(this.state);
    this.left = new LeftPanel(this.state, this.store, this.settings);
    this.center = new CenterPanel(this.state, this.store, this.app);
    this.right = new RightPanel(this.state, this.store, this.app);

    this.rail.mount(railEl);
    this.left.mount(leftEl);
    this.center.mount(centerEl);
    this.right.mount(rightEl);

    this.storeUnsub = this.store.onUpdate(() => {
      this.left.refresh();
      this.center.refresh();
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onClose(): Promise<void> {
    this.storeUnsub?.();
    this.rail?.destroy();
    this.left?.destroy();
    this.center?.destroy();
    this.right?.destroy();
    this.contentEl.empty();
  }
}
```

- [ ] **Step 3: Add layout CSS to `styles.css`**

Prepend at the very top of `styles.css` (before existing `.tasksCalendar` rules):

```css
/* ============================================================
   Task Calendar — Three-Panel Layout
   ============================================================ */

.tc-panel-view {
  padding: 0 !important;
  overflow: hidden !important;
  display: flex;
  flex-direction: column;
}

.tc-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--background-primary);
  font-family: var(--font-interface);
}

/* Rail */
.tc-rail {
  width: 48px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  background: var(--background-secondary);
  border-right: 1px solid var(--background-modifier-border);
  gap: 2px;
  z-index: 1;
}

/* Left panel */
.tc-left {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--background-secondary);
  border-right: 1px solid var(--background-modifier-border);
  overflow-y: auto;
  overflow-x: hidden;
}

/* Center panel */
.tc-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--background-primary);
  overflow: hidden;
}

/* Right panel */
.tc-right {
  width: 320px;
  flex-shrink: 0;
  background: var(--background-primary);
  border-left: 1px solid var(--background-modifier-border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 4: Build and visual check**

```bash
npm run build && obsidian plugin:reload id=task-calendar && sleep 1 && obsidian dev:screenshot path=screenshot-layout.png
```

Run the "Open view" command in Obsidian. You should see a four-column layout with placeholder text in each column.

- [ ] **Step 5: Commit**

```bash
git add src/panels/RailPanel.ts src/panels/LeftPanel.ts src/panels/CenterPanel.ts src/panels/RightPanel.ts src/views/PanelView.ts styles.css && git commit -m "feat: four-panel layout shell with AppState orchestration"
```

---

## Task 5: RailPanel + LeftPanel (Full Implementation)

**Files:**
- Rewrite: `src/panels/RailPanel.ts`
- Rewrite: `src/panels/LeftPanel.ts`
- Modify: `styles.css` (add rail + left panel component styles)

**Interfaces:**
- Consumes: `AppState` (mode, selectedList), `TaskStore.getTasks()`, `CalendarSettings.tagGroups`
- Produces: Clickable Rail icons that change `state.mode`; Left panel smart lists and tag groups that change `state.selectedList`

- [ ] **Step 1: Rewrite `src/panels/RailPanel.ts`**

```typescript
import { setIcon } from 'obsidian';
import type { AppState, ViewMode } from '../app/AppState';

interface RailItem {
  mode: ViewMode;
  icon: string;
  label: string;
}

const ITEMS: RailItem[] = [
  { mode: 'tasks', icon: 'list-checks', label: 'Tasks' },
  { mode: 'calendar', icon: 'calendar-days', label: 'Calendar' },
  { mode: 'search', icon: 'search', label: 'Search' },
];

export class RailPanel {
  private el!: HTMLElement;
  private offMode?: () => void;

  constructor(private state: AppState) {}

  mount(container: HTMLElement): void {
    this.el = container;
    this.offMode = this.state.on('mode', () => this.render());
    this.render();
  }

  destroy(): void {
    this.offMode?.();
    this.el?.empty();
  }

  private render(): void {
    this.el.empty();
    const mode = this.state.get('mode');

    const topGroup = this.el.createDiv({ cls: 'tc-rail-top' });
    for (const item of ITEMS) {
      const btn = topGroup.createEl('button', {
        cls: `tc-rail-btn${mode === item.mode ? ' is-active' : ''}`,
        attr: { 'aria-label': item.label, title: item.label },
      });
      setIcon(btn, item.icon);
      btn.addEventListener('click', () => {
        this.state.set('mode', item.mode);
      });
    }

    // Settings at bottom
    const bottomGroup = this.el.createDiv({ cls: 'tc-rail-bottom' });
    const settingsBtn = bottomGroup.createEl('button', {
      cls: 'tc-rail-btn',
      attr: { 'aria-label': 'Settings', title: 'Settings' },
    });
    setIcon(settingsBtn, 'settings');
    settingsBtn.addEventListener('click', () => {
      // Open Obsidian settings and navigate to plugin tab
      const app = (this.state as unknown as { _app?: { setting?: { open?: () => void; openTabById?: (id: string) => void } } })._app;
      app?.setting?.open?.();
      app?.setting?.openTabById?.('task-calendar');
    });
  }
}
```

Note: The settings button needs the app reference. Pass it through the constructor instead:

```typescript
// Updated constructor signature:
constructor(private state: AppState, private app: { setting?: { open?: () => void; openTabById?: (id: string) => void } }) {}
```

Update `PanelView.ts` to pass `this.app` as second argument to `RailPanel`:
```typescript
this.rail = new RailPanel(this.state, this.app as never);
```

- [ ] **Step 2: Rewrite `src/panels/LeftPanel.ts`**

```typescript
import type { AppState, ListSelection } from '../app/AppState';
import type { Task } from '../parser/types';
import type { CalendarSettings, TagGroup } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';

export class LeftPanel {
  private el!: HTMLElement;
  private offs: Array<() => void> = [];

  constructor(
    private state: AppState,
    private store: TaskStore,
    private settings: CalendarSettings,
  ) {}

  mount(container: HTMLElement): void {
    this.el = container;
    this.offs.push(
      this.state.on('selectedList', () => this.render()),
      this.state.on('mode', () => this.render()),
    );
    this.render();
  }

  refresh(): void { this.render(); }

  destroy(): void {
    this.offs.forEach((f) => f());
    this.el?.empty();
  }

  private render(): void {
    this.el.empty();
    const mode = this.state.get('mode');
    if (mode === 'search') return; // hidden in search mode

    const allTasks = this.store.getTasks();
    const today = window.moment().format('YYYY-MM-DD');

    this.el.createDiv({ cls: 'tc-left-section' }, (section) => {
      this.renderSmartList(section, 'inbox', 'Inbox', 'inbox', this.countInbox(allTasks));
      this.renderSmartList(section, 'today', 'Today', 'calendar', this.countToday(allTasks, today));
      this.renderSmartList(section, 'upcoming', 'Upcoming', 'arrow-up-right', this.countUpcoming(allTasks, today));
    });

    const groups = this.settings.tagGroups;
    if (groups.length > 0) {
      this.el.createDiv({ cls: 'tc-left-divider' });
      this.el.createDiv({ cls: 'tc-left-section' }, (section) => {
        for (const group of groups) {
          this.renderTagGroup(section, group, allTasks);
        }
      });
    }
  }

  private renderSmartList(
    parent: HTMLElement,
    selection: ListSelection,
    label: string,
    icon: string,
    count: number,
  ): void {
    const current = this.state.get('selectedList');
    const isActive = current === selection;
    const row = parent.createDiv({ cls: `tc-left-item${isActive ? ' is-active' : ''}` });

    const left = row.createDiv({ cls: 'tc-left-item-left' });
    left.createEl('span', { cls: `tc-left-icon lucide-${icon}` });
    left.createEl('span', { cls: 'tc-left-label', text: label });

    if (count > 0) {
      row.createEl('span', { cls: 'tc-left-count', text: String(count) });
    }

    row.addEventListener('click', () => {
      this.state.set('selectedList', selection);
      this.state.set('mode', 'tasks');
    });
  }

  private renderTagGroup(parent: HTMLElement, group: TagGroup, allTasks: Task[]): void {
    const sel = this.state.get('selectedList');
    const isGroupActive =
      typeof sel === 'object' && sel.type === 'group' && sel.groupId === group.id;

    const container = parent.createDiv({ cls: 'tc-tag-group' });
    const header = container.createDiv({ cls: `tc-tag-group-header${isGroupActive ? ' is-active' : ''}` });

    const tags = this.resolveGroupTags(group, allTasks);
    const isExpanded = isGroupActive || tags.some((t) => {
      const s = this.state.get('selectedList');
      return typeof s === 'object' && s.type === 'tag' && s.tag === t;
    });

    header.createEl('span', { cls: `tc-left-icon tc-group-arrow${isExpanded ? ' is-open' : ''}`, text: isExpanded ? '▼' : '▶' });
    if (group.color) {
      const dot = header.createEl('span', { cls: 'tc-group-dot' });
      dot.style.background = group.color;
    }
    header.createEl('span', { cls: 'tc-left-label', text: group.name });

    const groupCount = allTasks.filter((t) =>
      tags.some((tag) => t.rawText.includes(tag) && t.status === 'open'),
    ).length;
    if (groupCount > 0) {
      header.createEl('span', { cls: 'tc-left-count', text: String(groupCount) });
    }

    header.addEventListener('click', () => {
      this.state.set('selectedList', { type: 'group', groupId: group.id });
      this.state.set('mode', 'tasks');
    });

    if (isExpanded) {
      const children = container.createDiv({ cls: 'tc-tag-group-children' });
      for (const tag of tags) {
        const label = group.mode === 'prefix' && group.prefix
          ? tag.replace(`#${group.prefix}/`, '').replace(`#${group.prefix}`, '(root)')
          : tag;
        const tagSel = this.state.get('selectedList');
        const isTagActive = typeof tagSel === 'object' && tagSel.type === 'tag' && tagSel.tag === tag;
        const tagCount = allTasks.filter((t) => t.rawText.includes(tag) && t.status === 'open').length;

        const child = children.createDiv({ cls: `tc-left-item tc-tag-child${isTagActive ? ' is-active' : ''}` });
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

  private resolveGroupTags(group: TagGroup, allTasks: Task[]): string[] {
    if (group.mode === 'prefix' && group.prefix) {
      const prefix = group.prefix;
      const found = new Set<string>();
      for (const task of allTasks) {
        const matches = task.rawText.match(/#[\w/-]+/gu) ?? [];
        for (const tag of matches) {
          if (tag === `#${prefix}` || tag.startsWith(`#${prefix}/`)) {
            found.add(tag);
          }
        }
      }
      return Array.from(found).sort();
    }
    return group.tags ?? [];
  }

  private countInbox(tasks: Task[]): number {
    const { inboxMode, inboxTag } = this.settings;
    if (inboxMode === 'tag') {
      return tasks.filter((t) => t.status === 'open' && t.rawText.includes(inboxTag)).length;
    }
    return tasks.filter((t) => {
      if (t.status !== 'open') return false;
      return !(/#[\w/-]+/u.test(t.rawText));
    }).length;
  }

  private countToday(tasks: Task[], today: string): number {
    return tasks.filter((t) => {
      if (t.status !== 'open') return false;
      return t.due === today || t.scheduled === today || t.dailyNoteDate === today;
    }).length;
  }

  private countUpcoming(tasks: Task[], today: string): number {
    return tasks.filter((t) => {
      if (t.status !== 'open') return false;
      const d = t.due ?? t.scheduled ?? t.dailyNoteDate;
      return d !== undefined && d > today;
    }).length;
  }
}
```

- [ ] **Step 3: Add Rail + Left panel CSS to `styles.css`** (append after the layout section added in Task 4):

```css
/* ---- Rail ---- */
.tc-rail-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 1;
}
.tc-rail-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 4px;
}
.tc-rail-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--icon-color);
  cursor: pointer;
  padding: 0;
  transition: background 0.1s;
}
.tc-rail-btn:hover {
  background: var(--background-modifier-hover);
  color: var(--icon-color-hover);
}
.tc-rail-btn.is-active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}
.tc-rail-btn svg {
  width: 18px;
  height: 18px;
}

/* ---- Left Panel ---- */
.tc-left-section {
  padding: 8px 0;
}
.tc-left-divider {
  height: 1px;
  background: var(--background-modifier-border);
  margin: 4px 12px;
}
.tc-left-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px 5px 16px;
  border-radius: 6px;
  margin: 1px 6px;
  cursor: pointer;
  user-select: none;
  color: var(--nav-item-color);
  font-size: 13.5px;
}
.tc-left-item:hover {
  background: var(--nav-item-background-hover);
  color: var(--nav-item-color-hover);
}
.tc-left-item.is-active {
  background: var(--nav-item-background-active);
  color: var(--nav-item-color-active);
  font-weight: 500;
}
.tc-left-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.tc-left-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tc-left-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.7;
  display: flex;
  align-items: center;
}
.tc-left-count {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* Tag groups */
.tc-tag-group {
  margin: 1px 6px;
}
.tc-tag-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  color: var(--nav-item-color);
  font-size: 13.5px;
  font-weight: 500;
}
.tc-tag-group-header:hover { background: var(--nav-item-background-hover); }
.tc-tag-group-header.is-active { background: var(--nav-item-background-active); }
.tc-group-arrow { font-size: 10px; opacity: 0.5; transition: transform 0.15s; }
.tc-group-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.tc-tag-group-children { padding-left: 8px; }
.tc-tag-child { font-weight: normal; }

/* Settings card */
.tc-settings-group-card {
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  padding: 8px 12px;
  margin: 8px 0;
}
```

- [ ] **Step 4: Build and visual check**

```bash
npm run build && obsidian plugin:reload id=task-calendar && sleep 1 && obsidian dev:screenshot path=screenshot-left.png
```

Open the "Task calendar" tab. Verify: Rail has three icons + settings gear. Left panel shows Inbox/Today/Upcoming with counts. Clicking items highlights them.

- [ ] **Step 5: Commit**

```bash
git add src/panels/RailPanel.ts src/panels/LeftPanel.ts styles.css && git commit -m "feat: implement RailPanel and LeftPanel with smart lists and tag groups"
```

---

## Task 6: CenterPanel — Task List, Grouping, Local Search

**Files:**
- Rewrite: `src/panels/CenterPanel.ts`
- Modify: `styles.css` (center panel + task card styles)

**Interfaces:**
- Consumes: `AppState` (selectedList, mode, centerFilter); `TaskStore.getTasks()`
- Produces: Filtered, grouped task list. Clicking task calls `state.set('taskStack', [task])`

- [ ] **Step 1: Rewrite `src/panels/CenterPanel.ts`**

```typescript
import type { App } from 'obsidian';
import type { AppState, ListSelection } from '../app/AppState';
import type { Task } from '../parser/types';
import type { TaskStore } from '../store/TaskStore';

export class CenterPanel {
  private el!: HTMLElement;
  private offs: Array<() => void> = [];

  constructor(
    private state: AppState,
    private store: TaskStore,
    private app: App,
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

  refresh(): void { this.render(); }

  destroy(): void {
    this.offs.forEach((f) => f());
    this.el?.empty();
  }

  private render(): void {
    this.el.empty();
    const mode = this.state.get('mode');

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
    }) as HTMLInputElement;
    searchInput.value = this.state.get('centerFilter');
    searchInput.addEventListener('input', () => {
      this.state.set('centerFilter', searchInput.value);
    });

    const tasks = this.getFilteredTasks();
    const scroll = this.el.createDiv({ cls: 'tc-center-scroll' });

    if (tasks.length === 0) {
      scroll.createDiv({ cls: 'tc-center-empty', text: 'No tasks' });
      return;
    }

    const sel = this.state.get('selectedList');
    const needsGrouping = sel === 'today' || sel === 'upcoming';

    if (needsGrouping) {
      this.renderGrouped(scroll, tasks);
    } else {
      this.renderFlat(scroll, tasks);
    }
  }

  private renderSearch(): void {
    const header = this.el.createDiv({ cls: 'tc-center-header' });
    header.createEl('h2', { cls: 'tc-center-title', text: 'Search' });
    const input = header.createEl('input', {
      cls: 'tc-center-search tc-search-global',
      attr: { type: 'text', placeholder: 'Search all tasks…' },
    }) as HTMLInputElement;
    input.value = this.state.get('searchQuery');
    input.addEventListener('input', () => this.state.set('searchQuery', input.value));
    setTimeout(() => input.focus(), 0);

    const query = this.state.get('searchQuery').toLowerCase();
    if (!query) return;

    const results = this.store.getTasks().filter((t) =>
      t.text.toLowerCase().includes(query) ||
      t.rawText.toLowerCase().includes(query),
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
      if (!d || d < today) { groups[0]!.tasks.push(task); }
      else if (d === today) { groups[1]!.tasks.push(task); }
      else if (d === tomorrow) { groups[2]!.tasks.push(task); }
      else { groups[3]!.tasks.push(task); }
    }

    for (const group of groups) {
      if (group.tasks.length === 0) continue;
      container.createDiv({ cls: 'tc-group-header', text: `${group.label}  ${group.tasks.length}` });
      for (const task of group.tasks) this.renderTaskCard(container, task);
    }
  }

  private renderFlat(container: HTMLElement, tasks: Task[]): void {
    for (const task of tasks) this.renderTaskCard(container, task);
  }

  private renderTaskCard(container: HTMLElement, task: Task): void {
    const stack = this.state.get('taskStack');
    const current = stack[stack.length - 1];
    const isSelected = current && 'line' in current && current.line === task.line && current.filePath === task.filePath;

    const card = container.createDiv({ cls: `tc-task-card${isSelected ? ' is-selected' : ''}` });

    // Checkbox
    const checkbox = card.createEl('input', {
      cls: 'tc-task-checkbox',
      attr: { type: 'checkbox' },
    }) as HTMLInputElement;
    checkbox.checked = task.status === 'done';
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      void this.store.toggleTask(task);
    });

    const body = card.createDiv({ cls: 'tc-task-body' });

    // Title row
    const titleRow = body.createDiv({ cls: 'tc-task-title-row' });
    titleRow.createEl('span', { cls: 'tc-task-title', text: task.text });

    // Meta row
    const meta = body.createDiv({ cls: 'tc-task-meta' });

    if (task.description) {
      meta.createDiv({ cls: 'tc-task-desc', text: task.description.split('\n')[0] ?? '' });
    }

    const pills = meta.createDiv({ cls: 'tc-task-pills' });
    const d = task.due ?? task.scheduled ?? task.dailyNoteDate;
    if (d) {
      pills.createEl('span', { cls: `tc-task-date${this.isOverdue(d) ? ' is-overdue' : ''}`, text: this.formatDate(d) });
    }
    const tags = task.rawText.match(/#[\w/-]+/gu) ?? [];
    for (const tag of tags.slice(0, 2)) {
      pills.createEl('span', { cls: 'tc-task-tag', text: tag });
    }
    if (task.subtasks?.length) {
      const done = task.subtasks.filter((s) => s.status === 'done').length;
      pills.createEl('span', { cls: 'tc-task-progress', text: `${done}/${task.subtasks.length}` });
    }

    card.addEventListener('click', () => {
      this.state.set('taskStack', [task]);
    });
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
            const d = t.due ?? t.scheduled ?? t.dailyNoteDate;
            return t.status === 'open' && (d === today || d === undefined) &&
              (t.due === today || t.scheduled === today || t.dailyNoteDate === today);
          });
          break;
        case 'upcoming':
          tasks = this.store.getTasks().filter((t) => {
            if (t.status !== 'open') return false;
            const d = t.due ?? t.scheduled ?? t.dailyNoteDate;
            return d !== undefined && d >= today;
          }).sort((a, b) => {
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
      const group = (this.state as unknown as { _settings?: { tagGroups?: Array<{ id: string; tags?: string[]; prefix?: string; mode: string }> } })._settings?.tagGroups?.find((g) => g.id === sel.groupId);
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
    // settings not directly available — use store with no filter for all tasks
    // The LeftPanel owns settings; CenterPanel approximates:
    return this.store.getTasks().filter((t) => {
      if (t.status !== 'open') return false;
      return !(/#[\w/-]+/u.test(t.rawText));
    });
  }

  private getTitle(): string {
    const sel = this.state.get('selectedList');
    if (sel === 'inbox') return 'Inbox';
    if (sel === 'today') return 'Today';
    if (sel === 'upcoming') return 'Upcoming';
    if (typeof sel === 'object' && sel.type === 'tag') return sel.tag;
    if (typeof sel === 'object' && sel.type === 'group') return 'Group';
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
```

Note: `CenterPanel` needs access to settings for inbox mode and group tags. Pass settings through constructor: update `PanelView.ts` to pass `this.settings` and update constructor:
```typescript
constructor(private state: AppState, private store: TaskStore, private app: App, private settings: CalendarSettings) {}
```
And update `PanelView`:
```typescript
this.center = new CenterPanel(this.state, this.store, this.app, this.settings);
```
Replace the `getInboxTasks` and group filter logic to use `this.settings` directly.

- [ ] **Step 2: Add Center panel CSS to `styles.css`**

```css
/* ---- Center Panel ---- */
.tc-center-header {
  padding: 16px 16px 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--background-modifier-border);
}
.tc-center-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  flex: 1;
  color: var(--text-normal);
}
.tc-center-search {
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  color: var(--text-normal);
  padding: 0 8px;
  font-size: 13px;
  width: 160px;
  outline: none;
  transition: border-color 0.15s, width 0.2s;
}
.tc-center-search:focus {
  border-color: var(--interactive-accent);
  width: 200px;
}
.tc-search-global { width: 100%; }
.tc-center-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.tc-center-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 40px 20px;
  font-size: 14px;
}
.tc-group-header {
  padding: 10px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

/* Task card */
.tc-task-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 16px;
  border-radius: 6px;
  margin: 1px 8px;
  cursor: pointer;
  transition: background 0.1s;
}
.tc-task-card:hover { background: var(--background-modifier-hover); }
.tc-task-card.is-selected { background: var(--background-modifier-active-hover); }
.tc-task-checkbox {
  margin-top: 2px;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--interactive-accent);
}
.tc-task-body { flex: 1; min-width: 0; }
.tc-task-title-row { display: flex; align-items: baseline; gap: 8px; }
.tc-task-title {
  font-size: 14px;
  color: var(--text-normal);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.tc-task-meta { display: flex; flex-direction: column; gap: 3px; margin-top: 2px; }
.tc-task-desc {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tc-task-pills {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.tc-task-date {
  font-size: 11px;
  color: var(--text-accent);
  font-weight: 500;
}
.tc-task-date.is-overdue { color: var(--text-error); }
.tc-task-tag {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--background-modifier-hover);
  padding: 1px 5px;
  border-radius: 3px;
}
.tc-task-progress {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--background-modifier-hover);
  padding: 1px 5px;
  border-radius: 3px;
}
```

- [ ] **Step 3: Build and visual check**

```bash
npm run build && obsidian plugin:reload id=task-calendar && sleep 1 && obsidian dev:screenshot path=screenshot-center.png
```

Verify: Task list appears in center panel. Switching left panel items updates the list. Search bar filters tasks.

- [ ] **Step 4: Commit**

```bash
git add src/panels/CenterPanel.ts styles.css && git commit -m "feat: implement CenterPanel with task list, grouping, and local search"
```

---

## Task 7: RightPanel — Task Detail, Chips, Sub-tasks, Comments, Drill-down

**Files:**
- Rewrite: `src/panels/RightPanel.ts`
- Modify: `styles.css` (right panel styles)

**Interfaces:**
- Consumes: `AppState.taskStack`; `TaskStore` for write-back
- Produces: Editable task detail. Write-back via `store.vault.process()` pattern (use `app.vault.process`)

- [ ] **Step 1: Rewrite `src/panels/RightPanel.ts`**

```typescript
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { AppState } from '../app/AppState';
import type { SubTask, Task, TaskComment } from '../parser/types';
import type { TaskStore } from '../store/TaskStore';

type TaskLike = Task | SubTask;

export class RightPanel {
  private el!: HTMLElement;
  private off?: () => void;

  constructor(
    private state: AppState,
    private store: TaskStore,
    private app: App,
  ) {}

  mount(container: HTMLElement): void {
    this.el = container;
    this.off = this.state.on('taskStack', () => this.render());
    this.render();
  }

  destroy(): void {
    this.off?.();
    this.el?.empty();
  }

  private render(): void {
    this.el.empty();
    const stack = this.state.get('taskStack');
    if (stack.length === 0) {
      this.renderEmpty();
      return;
    }
    const task = stack[stack.length - 1]!;
    this.renderTask(task, stack);
  }

  private renderEmpty(): void {
    const empty = this.el.createDiv({ cls: 'tc-right-empty' });
    empty.createEl('span', { text: 'Select a task to view details' });
  }

  private renderTask(task: TaskLike, stack: TaskLike[]): void {
    // Breadcrumb
    if (stack.length > 1) {
      const breadcrumb = this.el.createDiv({ cls: 'tc-breadcrumb' });
      stack.forEach((item, idx) => {
        if (idx > 0) breadcrumb.createEl('span', { cls: 'tc-breadcrumb-sep', text: ' › ' });
        const crumb = breadcrumb.createEl('span', {
          cls: `tc-breadcrumb-item${idx === stack.length - 1 ? ' is-current' : ''}`,
          text: item.text,
        });
        if (idx < stack.length - 1) {
          crumb.addEventListener('click', () => {
            this.state.set('taskStack', stack.slice(0, idx + 1));
          });
        }
      });
    }

    // Header
    const header = this.el.createDiv({ cls: 'tc-right-header' });
    const titleInput = header.createEl('input', {
      cls: 'tc-right-title',
      attr: { type: 'text', value: task.text },
    }) as HTMLInputElement;
    titleInput.addEventListener('blur', () => {
      if (titleInput.value !== task.text) {
        void this.updateTaskTitle(task, titleInput.value);
      }
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') titleInput.blur();
      if (e.key === 'Escape') { titleInput.value = task.text; titleInput.blur(); }
    });

    const headerActions = header.createDiv({ cls: 'tc-right-header-actions' });

    // Open in file button
    const openBtn = headerActions.createEl('button', {
      cls: 'tc-right-action-btn',
      attr: { title: 'Open in file', 'aria-label': 'Open in file' },
      text: '↗',
    });
    openBtn.addEventListener('click', () => { void this.openInFile(task); });

    // Metadata chips
    if ('due' in task || 'priority' in task) {
      const t = task as Task;
      const chips = this.el.createDiv({ cls: 'tc-chips-row' });

      // Date chip
      this.renderDateChip(chips, t);
      // Priority chip
      this.renderPriorityChip(chips, t);
      // Tag chips
      const tags = t.rawText.match(/#[\w/-]+/gu) ?? [];
      for (const tag of tags) {
        this.renderTagChip(chips, t, tag);
      }
      // Add tag
      const addTagBtn = chips.createEl('button', { cls: 'tc-chip tc-chip-add', text: '+ tag' });
      addTagBtn.addEventListener('click', () => this.showTagInput(chips, t, addTagBtn));
    }

    // Divider
    this.el.createDiv({ cls: 'tc-right-divider' });

    // Description
    const descSection = this.el.createDiv({ cls: 'tc-right-section' });
    descSection.createEl('div', { cls: 'tc-right-section-label', text: 'Description' });
    const descArea = descSection.createEl('textarea', {
      cls: 'tc-right-desc',
      attr: { placeholder: 'Add a description…', rows: '3' },
    }) as HTMLTextAreaElement;
    descArea.value = task.description ?? '';
    descArea.addEventListener('blur', () => {
      void this.updateDescription(task, descArea.value);
    });

    // Sub-tasks
    const subSection = this.el.createDiv({ cls: 'tc-right-section' });
    const subHeader = subSection.createDiv({ cls: 'tc-right-section-header' });
    subHeader.createEl('span', { cls: 'tc-right-section-label', text: 'Sub-tasks' });
    const addSubBtn = subHeader.createEl('button', { cls: 'tc-right-add-btn', text: '+ Add' });

    const subList = subSection.createDiv({ cls: 'tc-subtask-list' });
    for (const sub of task.subtasks ?? []) {
      this.renderSubTask(subList, sub);
    }

    addSubBtn.addEventListener('click', () => {
      const input = subSection.createEl('input', {
        cls: 'tc-subtask-new-input',
        attr: { type: 'text', placeholder: 'New sub-task…' },
      }) as HTMLInputElement;
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          void this.addSubTask(task, input.value.trim());
        }
        if (e.key === 'Escape') input.remove();
      });
      input.addEventListener('blur', () => {
        if (input.value.trim()) void this.addSubTask(task, input.value.trim());
        else input.remove();
      });
    });

    // Comments
    const commentSection = this.el.createDiv({ cls: 'tc-right-section' });
    commentSection.createEl('div', { cls: 'tc-right-section-label', text: 'Comments' });

    const commentList = commentSection.createDiv({ cls: 'tc-comment-list' });
    for (const comment of task.comments ?? []) {
      this.renderComment(commentList, comment);
    }

    const commentInput = commentSection.createEl('textarea', {
      cls: 'tc-comment-input',
      attr: { placeholder: 'Write a comment…', rows: '2' },
    }) as HTMLTextAreaElement;
    const sendBtn = commentSection.createEl('button', { cls: 'tc-comment-send', text: 'Add comment' });
    sendBtn.addEventListener('click', () => {
      if (commentInput.value.trim()) {
        void this.addComment(task, commentInput.value.trim());
        commentInput.value = '';
      }
    });
  }

  private renderSubTask(container: HTMLElement, sub: SubTask): void {
    const row = container.createDiv({ cls: 'tc-subtask-row' });
    const cb = row.createEl('input', {
      cls: 'tc-task-checkbox',
      attr: { type: 'checkbox' },
    }) as HTMLInputElement;
    cb.checked = sub.status === 'done';
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      void this.toggleSubTask(sub);
    });
    const label = row.createEl('span', {
      cls: `tc-subtask-label${sub.status === 'done' ? ' is-done' : ''}`,
      text: sub.text,
    });
    label.addEventListener('click', () => {
      const stack = this.state.get('taskStack');
      this.state.set('taskStack', [...stack, sub]);
    });

    if ((sub.subtasks?.length ?? 0) > 0) {
      const done = sub.subtasks!.filter((s) => s.status === 'done').length;
      row.createEl('span', { cls: 'tc-subtask-progress', text: `${done}/${sub.subtasks!.length}` });
    }
  }

  private renderComment(container: HTMLElement, comment: TaskComment): void {
    const row = container.createDiv({ cls: 'tc-comment-row' });
    row.createEl('span', { cls: 'tc-comment-text', text: comment.text });
    if (comment.date) {
      row.createEl('span', { cls: 'tc-comment-date', text: comment.date });
    }
  }

  private renderDateChip(container: HTMLElement, task: Task): void {
    const d = task.due ?? task.scheduled;
    const chip = container.createEl('button', {
      cls: `tc-chip${d ? '' : ' tc-chip-empty'}`,
      text: d ? `📅 ${this.formatDate(d)}` : '📅 Date',
    });
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showDatePopover(chip, task);
    });
  }

  private renderPriorityChip(container: HTMLElement, task: Task): void {
    const labels: Record<string, string> = { A: '⏫ High', B: '🔼 Medium', C: 'Priority', D: '🔽 Low' };
    const chip = container.createEl('button', {
      cls: `tc-chip${task.priority === 'C' ? ' tc-chip-empty' : ''}`,
      text: labels[task.priority] ?? 'Priority',
    });
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showPriorityPopover(chip, task);
    });
  }

  private renderTagChip(container: HTMLElement, task: Task, tag: string): void {
    const chip = container.createEl('span', { cls: 'tc-chip tc-chip-tag' });
    chip.createEl('span', { text: tag });
    const x = chip.createEl('button', { cls: 'tc-chip-remove', text: '×' });
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.removeTag(task, tag);
    });
  }

  private showDatePopover(anchor: HTMLElement, task: Task): void {
    const existing = this.el.querySelector('.tc-popover');
    if (existing) { existing.remove(); return; }
    const pop = this.el.createDiv({ cls: 'tc-popover tc-date-popover' });
    const input = pop.createEl('input', {
      cls: 'tc-date-input',
      attr: { type: 'date', value: task.due ?? task.scheduled ?? '' },
    }) as HTMLInputElement;
    input.addEventListener('change', () => {
      void this.updateDate(task, input.value);
      pop.remove();
    });
    input.addEventListener('blur', () => setTimeout(() => pop.remove(), 200));
    setTimeout(() => input.focus(), 0);
  }

  private showPriorityPopover(anchor: HTMLElement, task: Task): void {
    const existing = this.el.querySelector('.tc-popover');
    if (existing) { existing.remove(); return; }
    const pop = this.el.createDiv({ cls: 'tc-popover tc-priority-popover' });
    const options: Array<{ value: string; label: string }> = [
      { value: 'A', label: '⏫ High' },
      { value: 'B', label: '🔼 Medium' },
      { value: 'C', label: 'None' },
      { value: 'D', label: '🔽 Low' },
    ];
    for (const opt of options) {
      const btn = pop.createEl('button', {
        cls: `tc-priority-option${task.priority === opt.value ? ' is-active' : ''}`,
        text: opt.label,
      });
      btn.addEventListener('click', () => {
        void this.updatePriority(task, opt.value);
        pop.remove();
      });
    }
    document.addEventListener('click', () => pop.remove(), { once: true });
  }

  private showTagInput(container: HTMLElement, task: Task, anchor: HTMLElement): void {
    const input = container.createEl('input', {
      cls: 'tc-tag-input',
      attr: { type: 'text', placeholder: '#tag' },
    }) as HTMLInputElement;
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        void this.addTag(task, input.value.trim());
        input.remove();
      }
      if (e.key === 'Escape') input.remove();
    });
    input.addEventListener('blur', () => setTimeout(() => input.remove(), 200));
  }

  // ---- Write-back helpers ----

  private async openInFile(task: TaskLike): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    const view = leaf.view as { editor?: { setCursor?: (pos: { line: number; ch: number }) => void } };
    view.editor?.setCursor?.({ line: task.line, ch: 0 });
  }

  private async updateTaskTitle(task: TaskLike, newText: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      // Replace text portion only — keep checkbox and metadata
      lines[task.line] = line.replace(task.text, newText);
      return lines.join('\n');
    });
  }

  private async updateDescription(task: TaskLike, newDesc: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const taskLine = lines[task.line];
      if (!taskLine) return data;
      const indent = (taskLine.match(/^(\s*)/)?.[1] ?? '') + '  ';

      if (task.subtaskRange) {
        // Remove existing description lines
        for (let i = task.subtaskRange.from; i <= task.subtaskRange.to; i++) {
          if (/^\s*- > /.test(lines[i] ?? '')) {
            lines[i] = null as unknown as string;
          }
        }
      }

      const descLines = newDesc
        .split('\n')
        .filter(Boolean)
        .map((l) => `${indent}- > ${l}`);

      if (task.subtaskRange) {
        const insertAt = task.subtaskRange.from;
        lines.splice(insertAt, 0, ...descLines);
      } else {
        lines.splice(task.line + 1, 0, ...descLines);
      }

      return lines.filter((l) => l !== null).join('\n');
    });
  }

  private async addSubTask(task: TaskLike, text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const taskLine = lines[task.line];
      if (!taskLine) return data;
      const indent = (taskLine.match(/^(\s*)/)?.[1] ?? '') + '  ';
      const newLine = `${indent}- [ ] ${text}`;
      const insertAt = task.subtaskRange ? task.subtaskRange.to + 1 : task.line + 1;
      lines.splice(insertAt, 0, newLine);
      return lines.join('\n');
    });
  }

  private async toggleSubTask(sub: SubTask): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(sub.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[sub.line];
      if (!line) return data;
      if (sub.status === 'open') {
        lines[sub.line] = line.replace(/- \[ \]/, '- [x]');
      } else {
        lines[sub.line] = line.replace(/- \[x\]/i, '- [ ]');
      }
      return lines.join('\n');
    });
  }

  private async addComment(task: TaskLike, text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const today = window.moment().format('YYYY-MM-DD');
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const taskLine = lines[task.line];
      if (!taskLine) return data;
      const indent = (taskLine.match(/^(\s*)/)?.[1] ?? '') + '  ';
      const commentLine = `${indent}- ${today}: ${text}`;
      const insertAt = task.subtaskRange ? task.subtaskRange.to + 1 : task.line + 1;
      lines.splice(insertAt, 0, commentLine);
      return lines.join('\n');
    });
  }

  private async updateDate(task: Task, date: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      if (task.due) {
        lines[task.line] = line.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${date}`);
      } else {
        lines[task.line] = line.trimEnd() + ` 📅 ${date}`;
      }
      return lines.join('\n');
    });
  }

  private async updatePriority(task: Task, priority: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const PRIORITY_EMOJIS = ['⏫', '🔼', '🔽'];
    const PRIORITY_MAP: Record<string, string> = { A: '⏫', B: '🔼', D: '🔽' };
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      let updated = line;
      for (const emoji of PRIORITY_EMOJIS) updated = updated.replace(emoji, '');
      updated = updated.trimEnd();
      if (priority !== 'C' && PRIORITY_MAP[priority]) updated += ` ${PRIORITY_MAP[priority]}`;
      lines[task.line] = updated;
      return lines.join('\n');
    });
  }

  private async removeTag(task: Task, tag: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      lines[task.line] = line.replace(tag, '').replace(/\s{2,}/gu, ' ').trimEnd();
      return lines.join('\n');
    });
  }

  private async addTag(task: Task, tag: string): Promise<void> {
    const tagStr = tag.startsWith('#') ? tag : `#${tag}`;
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      lines[task.line] = line.trimEnd() + ` ${tagStr}`;
      return lines.join('\n');
    });
  }

  private formatDate(d: string): string {
    const today = window.moment().format('YYYY-MM-DD');
    const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');
    if (d === today) return 'Today';
    if (d === tomorrow) return 'Tomorrow';
    return window.moment(d, 'YYYY-MM-DD').format('D MMM');
  }
}
```

- [ ] **Step 2: Add Right panel CSS to `styles.css`**

```css
/* ---- Right Panel ---- */
.tc-right-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
  padding: 20px;
  text-align: center;
}

/* Breadcrumb */
.tc-breadcrumb {
  padding: 8px 16px 4px;
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
}
.tc-breadcrumb-item {
  cursor: pointer;
  color: var(--text-accent);
}
.tc-breadcrumb-item:hover { text-decoration: underline; }
.tc-breadcrumb-item.is-current { color: var(--text-muted); cursor: default; text-decoration: none; }
.tc-breadcrumb-sep { color: var(--text-faint); }

/* Header */
.tc-right-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 8px;
}
.tc-right-title {
  flex: 1;
  font-size: 17px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: var(--text-normal);
  outline: none;
  padding: 2px 4px;
  border-radius: 4px;
  min-width: 0;
}
.tc-right-title:focus { background: var(--background-modifier-hover); }
.tc-right-header-actions { display: flex; gap: 4px; }
.tc-right-action-btn {
  width: 28px; height: 28px;
  border: none; background: transparent; border-radius: 4px;
  cursor: pointer; color: var(--icon-color);
  font-size: 14px; display: flex; align-items: center; justify-content: center;
}
.tc-right-action-btn:hover { background: var(--background-modifier-hover); }

/* Chips */
.tc-chips-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 16px 10px;
}
.tc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12.5px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  color: var(--text-normal);
  cursor: pointer;
  user-select: none;
  transition: background 0.1s, border-color 0.1s;
  white-space: nowrap;
}
.tc-chip:hover { background: var(--background-modifier-hover); border-color: var(--interactive-accent); }
.tc-chip-empty { color: var(--text-muted); border-style: dashed; }
.tc-chip-tag { cursor: default; }
.tc-chip-add { border-style: dashed; color: var(--text-muted); }
.tc-chip-remove {
  background: transparent; border: none; cursor: pointer;
  color: var(--text-muted); padding: 0 0 0 2px; font-size: 14px; line-height: 1;
}
.tc-chip-remove:hover { color: var(--text-normal); }

/* Popovers */
.tc-popover {
  position: absolute;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  z-index: 100;
  padding: 8px;
  min-width: 160px;
}
.tc-date-input {
  width: 100%; border: 1px solid var(--background-modifier-border);
  border-radius: 4px; padding: 4px 6px;
  background: var(--background-secondary); color: var(--text-normal);
}
.tc-priority-option {
  display: block; width: 100%; text-align: left;
  background: transparent; border: none; padding: 6px 10px;
  cursor: pointer; border-radius: 4px; color: var(--text-normal); font-size: 13px;
}
.tc-priority-option:hover { background: var(--background-modifier-hover); }
.tc-priority-option.is-active { font-weight: 600; color: var(--interactive-accent); }

/* Right panel body */
.tc-right-divider { height: 1px; background: var(--background-modifier-border); margin: 0 16px; }
.tc-right-section { padding: 12px 16px; }
.tc-right-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.tc-right-section-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.tc-right-add-btn {
  font-size: 12px; color: var(--text-accent); background: transparent;
  border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px;
}
.tc-right-add-btn:hover { background: var(--background-modifier-hover); }
.tc-right-desc {
  width: 100%; border: 1px solid var(--background-modifier-border);
  border-radius: 6px; padding: 8px; background: var(--background-secondary);
  color: var(--text-normal); font-size: 13.5px; resize: vertical; min-height: 60px;
  font-family: var(--font-text); outline: none; box-sizing: border-box;
}
.tc-right-desc:focus { border-color: var(--interactive-accent); }

/* Sub-tasks */
.tc-subtask-list { display: flex; flex-direction: column; gap: 4px; }
.tc-subtask-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.tc-subtask-label {
  font-size: 13.5px; color: var(--text-normal); cursor: pointer; flex: 1;
}
.tc-subtask-label:hover { text-decoration: underline; color: var(--text-accent); }
.tc-subtask-label.is-done { text-decoration: line-through; color: var(--text-muted); }
.tc-subtask-progress { font-size: 11px; color: var(--text-muted); }
.tc-subtask-new-input {
  width: 100%; margin-top: 6px; border: 1px solid var(--interactive-accent);
  border-radius: 4px; padding: 5px 8px; background: var(--background-primary);
  color: var(--text-normal); font-size: 13.5px; outline: none;
}

/* Comments */
.tc-comment-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.tc-comment-row {
  font-size: 13px; color: var(--text-normal);
  background: var(--background-secondary); border-radius: 6px;
  padding: 6px 10px; display: flex; flex-direction: column; gap: 2px;
}
.tc-comment-text { line-height: 1.4; }
.tc-comment-date { font-size: 11px; color: var(--text-muted); }
.tc-comment-input {
  width: 100%; border: 1px solid var(--background-modifier-border);
  border-radius: 6px; padding: 6px 8px; background: var(--background-secondary);
  color: var(--text-normal); font-size: 13px; resize: none;
  font-family: var(--font-text); outline: none; box-sizing: border-box;
}
.tc-comment-input:focus { border-color: var(--interactive-accent); }
.tc-comment-send {
  margin-top: 6px; padding: 5px 12px; font-size: 13px;
  background: var(--interactive-accent); color: var(--text-on-accent);
  border: none; border-radius: 6px; cursor: pointer; font-weight: 500;
}
.tc-comment-send:hover { background: var(--interactive-accent-hover); }
.tc-tag-input {
  padding: 3px 8px; font-size: 12px; border-radius: 20px;
  border: 1px solid var(--interactive-accent); background: var(--background-primary);
  color: var(--text-normal); outline: none; width: 100px;
}
```

- [ ] **Step 3: Build and visual check**

```bash
npm run build && obsidian plugin:reload id=task-calendar && sleep 1 && obsidian dev:screenshot path=screenshot-right.png
```

Click a task in center panel. Right panel should show title, chips, description area, sub-tasks, comments section. Clicking a sub-task label should drill down (breadcrumb appears).

- [ ] **Step 4: Commit**

```bash
git add src/panels/RightPanel.ts styles.css && git commit -m "feat: implement RightPanel with task detail, chips, drill-down, and write-back"
```

---

## Task 8: Dev Vault Data + Polish + Design Review Loop

**Files:**
- Update: `dev-vault/` markdown files (new sub-item format)
- Modify: `styles.css` (polish pass)

**Goal:** Update test data to use `- >` descriptions and date-format comments. Run the design-review loop until output looks production-quality.

- [ ] **Step 1: Update dev-vault files to new sub-item format**

Update `dev-vault/Daily/2026-06-23.md`:
```markdown
# 2026-06-23

- [ ] Написать отчёт за квартал 📅 2026-06-23 ⏰ 10:00 #work/reports
  - > Сравнить данные Q1 и Q2, подготовить сводную таблицу
  - [ ] Подготовить данные за Q2
  - [ ] Раздел по продажам
  - [x] Раздел по разработке
  - 2026-06-22: Антон попросил добавить раздел по маркетингу
- [ ] Code review для PR #142 📅 2026-06-23 ⏰ 14:00 #work/dev
  - [ ] Проверить логику авторизации
  - [ ] Убедиться что тесты покрывают edge cases
  - [ ] Написать комментарий к архитектурному решению
  - 2026-06-23: PR выглядит нормально, надо проверить только auth
- [x] Утренняя зарядка ✅ 2026-06-23 #personal/health
- [ ] Позвонить маме 📅 2026-06-23 ⏰ 19:00 #personal
```

Update `dev-vault/Inbox.md`:
```markdown
# Inbox

- [ ] Разобраться с архитектурой нового плагина
  - > Изучить как работает ItemView lifecycle в Obsidian
- [ ] Купить молоко и хлеб
- [ ] Почитать статью про time-blocking
- [ ] Ответить на письмо от Антона
- [ ] Записаться к врачу
```

- [ ] **Step 2: Run full build + all tests**

```bash
npm run build && npm run test:unit 2>&1 | tail -15
```
Expected: All tests pass, build succeeds.

- [ ] **Step 3: Design review loop — iteration 1**

```bash
obsidian plugin:reload id=task-calendar && sleep 1 && obsidian dev:screenshot path=screenshot-full.png
```

Then dispatch a design-review sub-agent (see instruction below). Fix any issues it reports, rebuild, re-screenshot, repeat until the sub-agent reports no major issues.

**Design review sub-agent prompt template:**
> You are a senior product designer reviewing a screenshot of an Obsidian plugin UI. The plugin aims to look and feel like TickTick — clean, modern, production-quality. Analyze the screenshot at `screenshot-full.png` using the Obsidian CLI: `obsidian dev:screenshot path=screenshot-full.png`. Then report: (1) layout issues (misalignment, wrong widths, overflow), (2) visual hierarchy problems (font sizes, contrast, spacing), (3) interaction affordances that are unclear, (4) anything that looks unpolished or inconsistent. Be specific with CSS class names to fix. Maximum 10 actionable items, prioritized.

- [ ] **Step 4: Final commit**

```bash
git add dev-vault/ styles.css && git commit -m "feat: update dev-vault data and polish UI styles"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Types: SubTask, TaskComment, Task extensions (Task 1)
- ✅ SubItemParser with all patterns (Task 1)
- ✅ TaskStore integration (Task 2)
- ✅ AppState bus (Task 2)
- ✅ TagGroup settings (Task 3)
- ✅ Inbox mode setting (Task 3)
- ✅ Four-panel layout (Task 4)
- ✅ Rail with Tasks/Calendar/Search (Task 5)
- ✅ Left panel: Inbox/Today/Upcoming + tag groups (Task 5)
- ✅ Prefix and manual tag group modes (Task 5)
- ✅ Muted counters (Task 5 CSS)
- ✅ Center panel: task cards, grouping, local search (Task 6)
- ✅ Right panel: breadcrumb, chips, description, sub-tasks, comments (Task 7)
- ✅ Write-back: title, date, priority, tag, description, sub-task, comment (Task 7)
- ✅ Open-in-file button ↗ (Task 7)
- ✅ Sub-task drill-down with taskStack (Task 7)
- ✅ Design review loop (Task 8)
- ⚠️ Calendar mode (Rail switches to existing CalendarRenderer) — wired at Rail level: clicking calendar icon sets `state.mode = 'calendar'`. CenterPanel renders existing CalendarRenderer in calendar mode. **Add to Task 6:** in `render()`, when `mode === 'calendar'`, mount the existing `CalendarRenderer`. This is one paragraph of code, add it in the CenterPanel render method.

**Gap fix — Calendar mode in CenterPanel:**

In `CenterPanel.render()`, add at the top:
```typescript
if (mode === 'calendar') {
  const config: ResolvedConfig = {
    ...DEFAULT_VIEW_CONFIG,
    ...this.settings,
    isMobile: false,
  };
  const renderer = new CalendarRenderer(this.el, this.store, config, this.app);
  renderer.mount();
  this._calendarRenderer = renderer;
  return;
}
```
Add `private _calendarRenderer: CalendarRenderer | null = null;` field and `this._calendarRenderer?.destroy()` at top of `render()`. Import `CalendarRenderer`, `DEFAULT_VIEW_CONFIG`, `ResolvedConfig` from existing modules. Pass `settings` through constructor.
