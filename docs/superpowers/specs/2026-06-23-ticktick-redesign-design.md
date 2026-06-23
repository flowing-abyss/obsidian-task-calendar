# TickTick-like Redesign — Design Spec

**Date:** 2026-06-23  
**Status:** Approved

---

## Overview

Transform the obsidian-task-calendar plugin from a calendar widget into a full-featured three-panel productivity UI inspired by TickTick, built on top of Tasks-plugin inline tasks. The plugin opens as a main-area tab and provides Inbox / Today / Upcoming smart lists, configurable tag groups, a task detail panel with sub-tasks and comments, and a mode rail for switching between Tasks, Calendar, and Search views.

---

## Layout

Four horizontal zones, fixed widths except the center which fills remaining space:

```
┌──────┬──────────────┬────────────────────────┬─────────────────┐
│ Rail │  Left panel  │    Center panel        │  Right panel    │
│ 48px │  240px       │    flex                │  320px          │
└──────┴──────────────┴────────────────────────┴─────────────────┘
```

---

## 1. Architecture

### File structure

Existing files (`TaskStore`, `TaskParser`, views, `CalendarRenderer`) are preserved and unchanged except where noted. New code lives in new directories.

```
src/
  app/
    AppState.ts            ← new: reactive state bus
  panels/
    RailPanel.ts           ← new: mode icon strip
    LeftPanel.ts           ← new: smart lists + tag groups
    CenterPanel.ts         ← new: task list + local search
    RightPanel.ts          ← new: task detail editor
  parser/
    SubItemParser.ts       ← new: parses sub-tasks, descriptions, comments
    TaskParser.ts          ← extend: call SubItemParser
    types.ts               ← extend: SubTask, TaskComment fields on Task
  settings/
    types.ts               ← extend: TagGroup[]
    defaults.ts            ← extend: tagGroups default []
    SettingsTab.ts         ← extend: tag group management UI
  views/
    PanelView.ts           ← refactor: orchestrates 4 panels, owns AppState
    (all other views unchanged)
```

### AppState

Minimal EventEmitter (~40 lines). Panels subscribe to specific fields; only subscribers of changed fields are notified.

```typescript
type ViewMode = 'tasks' | 'calendar' | 'search';

type ListSelection =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | { type: 'tag'; tag: string }
  | { type: 'group'; groupId: string };

interface AppStateData {
  mode: ViewMode;
  selectedList: ListSelection;
  taskStack: Array<Task | SubTask>; // drill-down stack; current = last element
  centerFilter: string;             // local search query in center panel
  searchQuery: string;              // global search query (Search mode)
}
```

`AppState.set(patch)` merges the patch and fires callbacks only for changed keys.

---

## 2. Sub-item Parsing

### Format

Indented list items directly under a task line are parsed as sub-items. Nesting is recursive to any depth.

| Pattern | Type |
|---|---|
| `- > text` | Description — multiple lines concatenated with `\n`; all written back when saved |
| `- [ ]` / `- [x]` | SubTask (open / done) |
| `- YYYY-MM-DD: text` | TaskComment with date |
| `- text` (everything else) | TaskComment without date |

Sub-tasks follow the same rules recursively — they can have their own `- >`, `- [ ]`, and `- date: comment` children.

### Type extensions

```typescript
interface SubTask {
  filePath: string;    // inherited from parent Task during parsing (needed for ↗ and write-back)
  line: number;
  text: string;
  status: 'open' | 'done';
  subtasks?: SubTask[];
  comments?: TaskComment[];
  description?: string; // all `- > text` lines concatenated with \n; first wins if multiple
  subtaskRange?: { from: number; to: number };
}

interface TaskComment {
  line: number;
  date?: string;   // YYYY-MM-DD
  text: string;
}

// Added to Task:
subtasks?: SubTask[];
comments?: TaskComment[];
description?: string;
subtaskRange?: { from: number; to: number }; // line range for write-back
```

### Write-back strategy

All writes use `vault.process()` (atomic, already used in `TaskStore`):
- **Task line** (title, metadata): rewrite `task.line`
- **Description**: rewrite the `- > ...` line within `subtaskRange`
- **Add sub-task**: insert after the last sub-task line in `subtaskRange`
- **Add comment**: append `- YYYY-MM-DD: text` at end of `subtaskRange`
- **Toggle sub-task**: flip `[ ]` ↔ `[x]` at the sub-task's line

---

## 3. Rail Panel

Narrow 48px icon strip on the far left. Icons centered vertically in their cells.

| Icon | Mode | Behavior |
|---|---|---|
| list | Tasks | Left + Center (task list) + Right |
| calendar | Calendar | Left hidden, Center = month/week view, Right stays |
| search | Search | Center = global search across all vault tasks |
| gear (bottom) | — | Opens plugin Settings tab |

Active mode uses Obsidian accent color. Hover shows a tooltip with the mode name.

---

## 4. Left Panel

### Smart Lists

| List | Filter logic |
|---|---|
| **Inbox** | Configurable: either tasks tagged `#inbox` (tag settable in settings) OR all tasks with no tags at all |
| **Today** | `due` = today OR `scheduled` = today OR `dailyNoteDate` = today |
| **Upcoming** | Any date field > today, sorted ascending |

Each item shows a small muted counter (single number, low-contrast grey).

### Tag Groups

Defined in settings. Two modes:

**Prefix mode** — provide a prefix string (e.g. `work`). The plugin auto-discovers all tags matching `#work` and `#work/*` from the vault and lists them as children. Children display only the suffix after `/`; tasks tagged exactly `#work` appear under the group root with count.

**Manual mode** — explicitly list tags. Order is drag-and-drop. Tags displayed as-is.

```typescript
interface TagGroup {
  id: string;
  name: string;
  color?: string;
  mode: 'prefix' | 'manual';
  prefix?: string;
  tags?: string[];
}
```

Left panel rendering:
```
  Inbox                          3
  Today                          5
  Upcoming                      12
  ──────────────────────────────
  ▼ Work                         8
      dev                        3
      meetings                   1
      reports                    2
      (root)                     2
  ▶ Personal
  ▶ Study
```

Clicking a group → filter by all tags in that group. Clicking a child tag → filter by that single tag.

---

## 5. Center Panel

### Task Card

```
○  Task title                             !  📅 сегодня
   Description preview (grey, truncated)    #tag  [2/3]
```

- Checkbox toggles task status
- Description first line shown in muted grey if present
- Priority shown as colored indicator
- Date shown relative (`сегодня`, `завтра`, short date) if within 7 days
- Tags as small grey pills
- `[N/M]` sub-task progress if sub-tasks exist

### Grouping (Today / Upcoming)

```
  Overdue   2
  Today     5
  Tomorrow  3
  25 Jun    2
```

### Local Search

Input at the top of Center panel. Filters current list in real-time by task text and tags. Independent from global Search mode.

---

## 6. Right Panel

### Header

```
[ Task title — inline editable ]            [↗] [⋯]
```

- `↗` — opens the source file at `task.line` in Obsidian editor
- `⋯` — context menu (delete task, copy link, etc.)

### Breadcrumb (drill-down)

When `taskStack.length > 1`, a breadcrumb appears above the title:

```
Написать отчёт  ›  Подготовить данные  ›  Данные по продажам
```

Clicking any breadcrumb item navigates back to that level (pops `taskStack`).

### Metadata chips

A single row of clickable chips below the title. Each opens an inline popover on click — no navigation away:

```
[📅 23 июн]  [⏰ 10:00]  [⏫ High]  [#work/reports ×]  [+ tag]
```

- **Date chip** → small calendar picker popover
- **Time chip** → inline time input
- **Priority chip** → 4-option dropdown (None / Low / Medium / High)
- **Tag chip** → shows `×` to remove; `+ tag` opens autocomplete field

### Body sections

1. **Description** — textarea, writes `- > text` to file. Placeholder: "Add a description…"
2. **Sub-tasks** — list with checkboxes + `+ Add` button. Each sub-task is clickable → pushes to `taskStack` (drill-down).
3. **Comments** — read-only list of existing comments (date shown in grey). Text input at bottom + "Send" button appends `- YYYY-MM-DD: text`.

### Design principles for the right panel

- All interactive elements must be immediately obvious (no hidden affordances)
- Clicking anywhere on a chip activates it — no tiny targets
- Auto-save on blur (no explicit Save button)
- Keyboard: Tab moves between metadata chips, Enter confirms, Escape cancels

---

## 7. Settings Extensions

### Inbox mode

```
Inbox source:  ○ Tag  ●  Untagged
Inbox tag:     [#inbox          ]
```

### Tag Groups

Section in SettingsTab with `+ Add group` button. Each group is an inline card:

```
┌─────────────────────────────────────────┐
│  Work                        [⠿] [✕]   │
│  Mode: [Prefix ▼]                       │
│  Prefix: [work        ]                 │
│  Preview: #work, #work/dev, #work/mtg   │
│  Color: [●]                             │
└─────────────────────────────────────────┘
```

In manual mode, the prefix field is replaced by a tag input with vault autocomplete and a list of added tags (each removable). Groups are reorderable via drag-and-drop.

---

## 8. Dev Workflow

A `dev-vault/` directory at the repo root contains a test Obsidian vault with sample tasks covering all scenarios (sub-tasks, comments, descriptions, all tag patterns, priorities, date ranges). The vault's plugin directory symlinks to the repo's `main.js`, `manifest.json`, and `styles.css` so `npm run dev` updates are live immediately.

Test loop:
1. `npm run dev` — watch build
2. `obsidian plugin:reload id=task-calendar` — reload plugin
3. `obsidian dev:screenshot path=screenshot.png` — capture UI
4. Design review sub-agent analyzes screenshot and reports issues
5. Fix → repeat from step 1

---

## 9. Out of Scope (Phase 1)

- Pomodoro timer
- Time-blocking (week view with hour slots)
- Recurring task creation UI
- Mobile layout
