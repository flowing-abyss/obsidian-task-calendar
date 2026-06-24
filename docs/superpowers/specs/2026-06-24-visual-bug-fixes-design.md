# Visual Bug Fixes — Design Spec

**Date:** 2026-06-24
**Status:** Reviewed & Approved
**Branch start:** 252fddf

## Bug List (B1–B15)

---

### B1 — Task card: metadata on the right (Todoist style)

**Problem:** Metadata (tags, date, progress) renders below the task title.

**Solution:** Restructure task card DOM in `CenterPanel.renderTaskCard`:
```
<div class="tc-task-card">
  <input checkbox>
  <div class="tc-task-body">        ← flex: 1, min-width: 0
    <div class="tc-task-title-row"> ← time + title
    [description span if present]
  </div>
  <div class="tc-task-meta-right">  ← flex-shrink: 0, align-items: center
    date | tags (max 2) | progress
  </div>
  <button class="tc-task-delete-btn">
</div>
```
CSS: `.tc-task-card { display:flex; align-items:flex-start }`. `.tc-task-meta-right { flex-shrink:0; display:flex; align-items:center; gap:6px }`.

---

### B2 — Right-panel tag chips inconsistent

**Problem:** Tag chips have inconsistent sizing — large × button, varying heights.

**Solution:** Unify `.tc-chip` and `.tc-chip-tag`. All chips height 24px, border-radius 12px, font-size 12px. Remove button: 14px, line-height 1, no border.

---

### B3 — Time popover: wrong position

**Problem:** `showTimePopover` uses `anchor.after(pop)` without `position: absolute`, so the popover pushes layout content down.

**Solution:** Make `.tc-popover` absolutely positioned relative to the nearest positioned ancestor. In `showTimePopover`, compute `offsetTop/offsetLeft` of anchor relative to `this.el` and set `pop.style.top/left`. Add `position: relative` to `.tc-right`.

---

### B4 — Sections: spacing + Todoist-style comments

**Problem:** Sections are cramped; comments require clicking a button instead of inline input.

**Solution:**
- Between sections: `padding-top: 20px`, `border-top: 1px solid var(--background-modifier-border)`.
- Comments: remove "Add comment" button entirely. Always show `<textarea placeholder="Write a comment…">`. Press Enter (without Shift) → save and clear. Shift+Enter → line break.
- Sub-tasks: remove `+ add` button from section header. Add inline `+ Add sub-task` row at the bottom of the subtask list (light text, click → inline input).

---

### B5 — Context menu: toggle + replace "Copy link"

**Problem:** Clicking ⋯ twice does not close the menu. "Copy link" is useless.

**Solution:**
- In `renderContextMenu`: before creating menu, check if `.tc-context-menu` is a child of `anchor` — if so, remove it and return (toggle behavior).
- Replace "Copy link" with "Open in file" (navigates to the task's source file).
- Both menu items close the menu after executing their action.

---

### B6 — Sub-tasks: indicators for nested data

**Problem:** Sub-tasks with their own sub-tasks or comments show no indicators.

**Solution:** In `renderSubTask` (RightPanel), add a meta row below the label:
- If `sub.subtasks?.length > 0` → show `done/N` progress chip
- If `sub.comments?.length > 0` → show `💬 N`

---

### B7 — Comments: dynamic update without losing focus

**Problem:** Adding a comment causes full right-panel re-render via store.onUpdate, losing focus.

**Solution:** Optimistic update — immediately `append` to the DOM comment list, then `vault.process` writes to file. No waiting for store response before updating UI. Focus and scroll position are preserved.

---

### B8 — Search: clicking a task navigates to its context

**Problem:** Clicking a task in search mode does nothing (right panel is hidden in search mode).

**Solution:** In `renderSearch`, on task click:
1. `state.set('mode', 'tasks')`
2. Three-way list logic: if `due < today` or `due/scheduled/dailyNoteDate === today` → `'today'`; if date is in the future → `'upcoming'`; else → `'inbox'`
3. `state.set('taskStack', [task])` — shows task in right panel

---

### B9 — Today view: include overdue tasks

**Problem:** `getFilteredTasks('today')` does not include overdue tasks.

**Solution:** In the 'today' filter, add overdue tasks (`due < today` and `status === 'open'`). Ensure the "Overdue" group renders first in `renderGrouped`.

---

### B10 — Tag groups: separate chevron from name click

**Problem:** The entire group header is one click zone that both expands and selects.

**Solution:** In `LeftPanel.renderTagGroup`:
- The `▶`/`▼` arrow is a separate element with `e.stopPropagation()` — click only toggles expand/collapse
- The rest of the header (dot + name + count) — click only selects (no expand toggle)

---

### B11 — Modal: close button overlaps ⋯ menu

**Problem:** `.tc-modal-close-btn` is absolutely positioned and overlaps action buttons.

**Solution:**
- In `TaskModal.open()`: after `innerPanel.mount(panelEl)`, query `panelEl.querySelector('.tc-right-header-actions')` and `appendChild` the close button there (no absolute positioning).
- Remove `position: absolute` from `.tc-modal-close-btn`.
- Chips inherit `.tc-chip` — verify `.tc-modal-body` does not reset styles.

---

### B12 — Calendar: navigation panel layout

**Problem:** Prev/next arrows are at opposite ends of the screen; title is too far from buttons.

**Solution:**
- Restructure nav: left group `[<] [Month Year] [>]`, right group `[Today] [Month|Week|List] [🎨]`.
- CSS: `tc-cal-nav { display:flex; justify-content:space-between }`. Left group: `tc-cal-nav-left { display:flex; gap:4px; align-items:center }`.
- Month/year as clickable buttons: `<button class="tc-cal-nav-month">June</button> <button class="tc-cal-nav-year">2026</button>` — clicking month shows 12-month grid popover; clicking year shows ±5 year list popover.
- Style selector: small `🎨` button in the right group. On click, cycles through styles style1→style2→...→style11→style1 (cycle, not dropdown — simpler for 11 items).

---

### B13 — View buttons: active state style

**Problem:** The active view button (Month/Week/List) has a purple outline that looks bad.

**Solution:** `.tc-cal-view-btn.is-active { background: var(--interactive-accent); color: white; border: none; outline: none; }` No box-shadow, no border-outline.

---

### B14 — List view: make it informative

**Problem:** List view shows ISO dates and empty task entries.

**Solution:** Rewrite `ListView.ts`:
- Date headers: `formatListDate(date)` → "Today", "Yesterday", "Mon, 23 Jun", etc.
- Tasks: compact cards with title + right-side meta (time, tags, progress) — same as center panel
- Overdue tasks shown with distinct "Overdue" section header in red

---

### B15 — Calendar style selector: restore toggle

**Problem:** style1–style11 are applied statically from settings; no in-panel UI to switch.

**Solution:** In `CenterPanel`: add `private calStyle: string` (initial value from settings). Add `🎨` cycle button in nav (see B12). `viewContainer` className updates when style changes.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/panels/CenterPanel.ts` | B1, B8, B9, B12, B13, B15 |
| `src/panels/RightPanel.ts` | B3, B4, B5, B6, B7 |
| `src/panels/LeftPanel.ts` | B10 |
| `src/ui/TaskModal.ts` | B11 |
| `src/views/ListView.ts` | B14 |
| `styles.css` | B2, B3, B11, B12, B13 |
