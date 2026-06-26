# Sort / Group / Filter — Design Spec

Date: 2026-06-26

## Overview

Add a unified Sort/Group/Filter system to the CenterPanel task list. Every list in the left panel gets its own persistent view state (group-by, sort-by, show-status, property filters). A dropdown button and clickable metadata elements let users drill into any view without leaving the panel.

---

## Header Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ Today          [#work ×][📄 note ×]  [↕]  [Filter...          ]  │
└────────────────────────────────────────────────────────────────────┘
```

- **Title** — left-aligned, existing behaviour
- **Filter chips** — appear only when property filters are active; right-aligned, before the dropdown
- **`[↕]` button** — opens Sort/Group/Show dropdown; changes colour when non-default settings are active
- **`[Filter...]` input** — text search, rightmost; in-memory only (not persisted)

---

## Sort/Group/Show Dropdown

Single button opens a popover with three rows. Each row has a label, current value, and expands a sub-list on click.

```
┌──────────────────────────────────────┐
│  ≡  Group by          None     ▸     │
│  ↕  Sort by           Date ↑   ▸     │
│  ○  Show              Active   ▸     │
└──────────────────────────────────────┘
```

### Group by options
| Value | Behaviour |
|---|---|
| None | Flat list (default for all lists except today/upcoming) |
| Date | Smart date groups: Overdue / Today / Tomorrow / Upcoming / {date} |
| Priority | Groups: 🔺 Highest / ⏫ High / 🔼 Medium / Normal / 🔽 Low / ⏬ Lowest |
| Tag | One group per first tag; untagged tasks go to "No tag" group |

### Sort by options
| Value | Default dir | Notes |
|---|---|---|
| Date | ↑ (nearest first) | Sorts by date then time together — `sortTasksByDateTime` logic |
| Priority | ↑ (A→F, highest first) | |
| Title | ↑ (A→Z) | |
| Tag | ↑ (A→Z by first tag) | |

Direction toggles on repeated click of the active item (↑ → ↓ → ↑).

### Show options
| Value | Filter applied |
|---|---|
| Active (default) | `status === 'open' \|\| status === 'in-progress'` |
| Completed | `status === 'done'` |
| All | no status filter |

---

## Property Filter Chips

Clicking specific metadata elements in a task card adds a dismissible chip to the header. Multiple chips are AND-combined with the current list filter.

| Click target | Chip label | Filter logic |
|---|---|---|
| Tag span in card | `#work/dev ×` | tasks whose rawText contains this tag |
| Source note chip | `📄 filename ×` | tasks whose filePath matches |
| Time span in card | `⏰ 14:00 ×` | tasks whose time matches |
| Right-click card → "Filter by priority" | `🔺 Highest ×` | tasks whose priority matches |

Left-panel selection (tag or group): also renders as a chip (without × — navigating away clears it naturally via list switch). When the user selects a different list, property filters for the *previous* list are preserved in that list's saved state; the new list loads its own saved filters.

### Clearing chips
- Click `×` on a chip → removes that filter, list re-renders
- Switch list → current list's chips are saved; new list loads its own chips
- `Esc` key in CenterPanel → clears all property filters for current list

---

## Per-List State Persistence

Every list remembers its own view state, persisted to `CalendarSettings` on disk.

### State shape

```typescript
interface ListViewState {
  groupBy: 'none' | 'date' | 'priority' | 'tag';
  sortBy: { field: 'date' | 'priority' | 'title' | 'tag'; dir: 'asc' | 'desc' };
  show: 'active' | 'completed' | 'all';
  filters: Array<
    | { type: 'tag';      value: string }
    | { type: 'file';     filePath: string }
    | { type: 'time';     value: string }
    | { type: 'priority'; value: TaskPriority }
  >;
}
```

### List key format

```
'inbox' | 'today' | 'upcoming'
'tag:#work/dev'
'group:<groupId>'
```

### Defaults per list

| List | groupBy | sortBy | show |
|---|---|---|---|
| today | date | date ↑ | active |
| upcoming | date | date ↑ | active |
| inbox | none | date ↑ | active |
| tag / group | none | date ↑ | active |

### Storage

`CalendarSettings` gains a new optional field:

```typescript
listViewStates?: Record<string, ListViewState>;
```

Saved on every change via the existing settings-save mechanism. Missing key → use defaults. Extends naturally to future "project" list type (key: `'project:<id>'`).

---

## `[↕]` Button Visual State

The button renders with an accent colour / dot indicator when the current list's state differs from its defaults in any field (groupBy, sortBy, show, or filters non-empty).

---

## AppState Changes

`centerFilter` stays as-is (in-memory text search string, not persisted).

Add:
```typescript
centerListViewState: ListViewState   // live state for the current list
```

On `selectedList` change: flush current `centerListViewState` to `settings.listViewStates[currentKey]`, load saved state for new key (or defaults), call `saveSettings()`.

`centerFilter` is reset to `''` on list switch (ephemeral).

---

## Rendering Changes in CenterPanel

### `getFilteredTasks()`
1. Apply list selection filter (existing)
2. Apply `show` status filter
3. Apply property filters (AND)
4. Apply `centerFilter` text filter (existing)
5. Apply `sortBy`

### `renderGrouped()` → generalised to `renderWithGrouping()`
Instead of hardcoded date groups only for today/upcoming:
- `groupBy === 'date'` → smart date labels (Overdue/Today/Tomorrow/Upcoming/dates)
- `groupBy === 'priority'` → priority level headers
- `groupBy === 'tag'` → first-tag headers
- `groupBy === 'none'` → flat (existing `renderFlat`)

### Task card click handlers (new)
- Tag span: `e.stopPropagation()` + add tag filter chip
- Source note chip: add file filter chip
- Time span: add time filter chip

---

## Verification Step

After implementation, use `obsidian` CLI to:
1. Reload plugin: `obsidian vault="dev-vault" plugin:reload id=task-calendar`
2. Take screenshot: `obsidian vault="dev-vault" dev:screenshot path=screenshot.png`
3. Verify DOM: `obsidian vault="dev-vault" dev:dom selector=".tc-center-header" text`

Confirm:
- `[↕]` button visible in header
- Dropdown opens with Group by / Sort by / Show rows
- Clicking a tag on a card adds a chip
- Chip has × and removes the filter on click
- Switching lists and returning preserves view state
- Non-default state → button accent colour visible
