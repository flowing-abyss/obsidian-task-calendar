import { Component, type App } from 'obsidian';
import type { Task, TaskPriority } from '../../parser/types';
import type { TagGroup } from '../../settings/types';
import type { StatusRegistry } from '../../status/StatusRegistry';
import { tagColorFor } from '../../tags/tagColor';
import { tagFillTextColorVar } from '../../tags/tagFillContrast';
import { renderStatusMarker } from '../../ui/StatusMarker';
import { renderTaskText } from '../../ui/renderTaskText';
import { showStatusMenuAt } from '../../ui/statusMenu';
import { statusTitleClass } from '../../ui/statusTitleClass';
import { hasMeta, renderCountBadges, renderTagChips } from './renderTaskMeta';

export interface AllDayCallbacks {
  app: App;
  component: Component;
  onTaskClick: (task: Task) => void;
  onDrop: (dragData: string, targetDate: string) => void; // native HTML5 DnD, existing convention
  onStartChange: (task: Task, newStart: string) => void; // pointer edge-resize
  onDueChange: (task: Task, newDue: string) => void; // pointer edge-resize
  onExtendToSpan: (task: Task, newDue: string) => void; // pointer edge-resize on a plain task
  onToggle: (task: Task) => void;
  onSetStatus: (task: Task, status: string) => void;
  onSetPriority: (task: Task, priority: TaskPriority) => void;
  statusRegistry: StatusRegistry;
  /** Click-to-create: fires when the user clicks genuinely empty space in this all-day cell
   * (not an existing span/plain/deadline item, and not the quick-add popover CenterPanel renders
   * into this same cell in response). Optional, mirroring TimeGridCallbacks.onCreateAtTime. */
  onCreateAtDate?: (date: string) => void;
}

/**
 * Test-only seam: real edge-resize resolves the date under the pointer via
 * `activeDocument.elementFromPoint` (unreliable in jsdom, which always returns `null`).
 * Each `renderAllDayCell` call stamps `data-tg-date` on `cellEl` and, for any edge
 * handle it renders, registers that handle's resolved callback here so tests can
 * trigger the resize deterministically without real screen coordinates.
 */
function endDragTestHook(cellEl: HTMLElement, targetDate: string): void {
  const pending = (cellEl as unknown as { __tgPendingEdgeResizes?: Array<(d: string) => void> })
    .__tgPendingEdgeResizes;
  pending?.forEach((cb) => cb(targetDate));
}

function renderDraggableBody(
  cellEl: HTMLElement,
  cls: string,
  task: Task,
  callbacks: AllDayCallbacks,
  tagGroups: TagGroup[],
): HTMLElement {
  const el = cellEl.createDiv({ cls: `tc-tg-body ${cls}` });
  // Status marker first: lets a user mark the item done without opening the modal. Its own
  // contextmenu handler stops propagation and opens the status/priority popover instead —
  // distinct from right-clicking this element's body below (opens the task modal).
  renderStatusMarker(el, {
    task,
    registry: callbacks.statusRegistry,
    onLeftClick: () => callbacks.onToggle(task),
    onContextMenu: (ev) => {
      ev.stopPropagation();
      showStatusMenuAt(ev, {
        task,
        registry: callbacks.statusRegistry,
        onPickStatus: (c) => callbacks.onSetStatus(task, c),
        onPickPriority: (p) => callbacks.onSetPriority(task, p),
      });
    },
  });
  // Task 21: `.tc-tg-body-title` (not a bare span) so it can be a flex child that
  // truncates independently — `.tc-tg-body` itself is now a flex row (marker + title +
  // meta) instead of block-stacking, matching renderTimedBlocks.ts's `.tc-tg-block-head`.
  // Task 38 follow-up: same is-done/is-cancelled strikethrough convention as timed
  // blocks (renderTimedBlocks.ts) — previously missing here, so a completed all-day
  // span/plain item read as plain/untouched while the same task's timed block elsewhere
  // showed struck-through.
  const titleEl = el.createSpan({ cls: `tc-tg-body-title${statusTitleClass(task.status)}` });
  renderTaskText(titleEl, task.markdownText, {
    app: callbacks.app,
    sourcePath: task.filePath,
    component: callbacks.component,
  });
  // Tag chips + count badges (subtasks/comments/links), matching TaskCard/CenterPanel's
  // visual language. Skipped when the task has neither. Non-interactive — see
  // renderTaskMeta.ts for why (avoids needing a pointerdown exclusion-guard here, next to
  // the whole-body drag and edge-resize handles this element carries).
  if (hasMeta(task)) {
    const meta = el.createSpan({ cls: 'tc-tg-body-meta' });
    renderCountBadges(meta, task);
    renderTagChips(meta, task, tagGroups, 2);
  }
  // Tag-colored fill only — the priority-colored border was removed (Task 12): the
  // status marker above already conveys priority via its own border, so a second
  // priority border on the body was redundant visual noise.
  const tagColor = tagColorFor(task.rawText, tagGroups);
  if (tagColor) {
    el.setCssProps({ '--tc-tag-color': tagColor });
    // Task 40 (Round 4): see tagFillContrast.ts's own doc comment — a fixed text color loses
    // contrast against a bright/pale or very dark/desaturated tag fill; only overridden when a
    // variant was actually computed, otherwise the CSS rule's var(--text-normal) fallback holds.
    const textColorVar = tagFillTextColorVar(el, tagColor);
    if (textColorVar) el.setCssProps({ '--tc-tag-text-color': textColorVar });
  }
  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', `${task.filePath}:::${task.line}`);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    el.addClass('is-dragging');
  });
  el.addEventListener('dragend', () => el.removeClass('is-dragging'));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    callbacks.onTaskClick(task);
  });
  return el;
}

/**
 * Attach pointer-based edge-resize to a handle (a span's start/due edge, or a plain
 * task's new right edge). In real usage the pointerup handler resolves the date under
 * the pointer via `activeDocument.elementFromPoint`, finding the nearest ancestor with
 * `data-tg-date` (stamped by whichever `renderAllDayCell` call rendered that day
 * column). Also registers a direct-invocation callback on `cellEl` for the jsdom test
 * seam (see `endDragTestHook`).
 *
 * `onResolve` is called with the resolved date once the drag ends over a valid day
 * cell; callers pass whichever mutation the handle should trigger (`onStartChange`,
 * `onDueChange`, or `onExtendToSpan`) so the drag mechanics stay shared.
 */
function attachEdgeResize(
  handle: HTMLElement,
  cellEl: HTMLElement,
  task: Task,
  onResolve: (task: Task, date: string) => void,
): void {
  // The handle sits inside a `draggable="true"` body (renderDraggableBody, for the
  // whole-task cross-day move). draggable="false" here is NOT enough on its own to stop a
  // mousedown+drag gesture starting on the handle from arming the ancestor's native HTML5
  // dragstart: per the HTML Drag and Drop spec, a mousedown on a non-draggable descendant of a
  // draggable element still starts a drag FROM THE ANCESTOR (the browser walks up to the
  // nearest draggable=true element and uses that as the drag source) — draggable="false" only
  // stops the handle itself from being independently draggable, it does not block the ancestor
  // fallback. Confirmed live (Task 37): dragging an edge handle armed the body's own `dragstart`,
  // which added `.is-dragging` (opacity: 0.5, styles.css) to the whole item for the duration of
  // the resize and fired `dragover`/`.is-drag-over` on every day cell the pointer crossed — the
  // washed-out "phantom" look and "grid becomes uneven" reports were this accidental native drag,
  // not a deliberate preview. Fixed below by flipping the ancestor's own `draggable` off for the
  // duration of the gesture (armed on this handle's pointerdown, restored on pointerup/cancel),
  // which actually prevents the fallback per spec, instead of racing it.
  handle.setAttribute('draggable', 'false');
  const body = handle.closest<HTMLElement>('.tc-tg-body');

  const resolve = (date: string): void => {
    onResolve(task, date);
  };

  // Task 39: live feedback for this edge-resize's day-crossing, mirroring
  // renderTimedBlocks.ts's attachHorizontalResize (Task 34/29's timed-span equivalent of this
  // gesture) — same reasoning: the commit already resolves the day under the pointer via
  // `elementFromPoint` on release, this just surfaces that resolution live by toggling
  // `.is-drag-over` on whichever `[data-tg-date]` cell the pointer is currently over, reusing
  // the SAME class the native cross-day drag (`renderAllDayCell`'s own dragover handler below)
  // already uses for an identical "this is where you'd land" signal.
  let hoveredDayEl: Element | null = null;

  const clearHoveredDay = (): void => {
    hoveredDayEl?.classList.remove('is-drag-over');
    hoveredDayEl = null;
  };

  const onPointerMove = (e: PointerEvent): void => {
    e.preventDefault();
    const target = activeDocument.elementFromPoint(e.clientX, e.clientY);
    const dayEl = target?.closest('[data-tg-date]') ?? null;
    if (dayEl === hoveredDayEl) return;
    hoveredDayEl?.classList.remove('is-drag-over');
    dayEl?.classList.add('is-drag-over');
    hoveredDayEl = dayEl;
  };

  // Task 37: a deliberate, lightweight "this is being reshaped" state — toggled purely as a CSS
  // class on the dragged item's own element (see .tc-tg-body.is-edge-resizing in styles.css), no
  // DOM creation/measurement and no sibling elements touched, so it can't itself cause the sibling
  // layout thrash the "grid becomes uneven" report described.
  const endResize = (): void => {
    body?.setAttribute('draggable', 'true');
    body?.removeClass('is-edge-resizing');
    clearHoveredDay();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };

  const onPointerUp = (upEvent: PointerEvent): void => {
    const target = activeDocument.elementFromPoint(upEvent.clientX, upEvent.clientY);
    const dayEl = target?.closest('[data-tg-date]');
    const date = dayEl?.getAttribute('data-tg-date');
    if (date) resolve(date);
    endResize();
  };

  // Defensive belt-and-suspenders (mirrors renderTimedBlocks.ts's attachHorizontalResize): if a
  // native drag were ever armed despite the draggable="false" flip above, the pointer session
  // would end in `pointercancel` rather than `pointerup`, and without this the window
  // pointermove/pointerup/pointercancel listeners would leak instead of being torn down.
  const onPointerCancel = (): void => {
    endResize();
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    body?.setAttribute('draggable', 'false');
    body?.addClass('is-edge-resizing');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  });

  const withHook = cellEl as HTMLElement & {
    __tgPendingEdgeResizes?: Array<(d: string) => void>;
  };
  withHook.__tgPendingEdgeResizes = withHook.__tgPendingEdgeResizes ?? [];
  withHook.__tgPendingEdgeResizes.push(resolve);
}

export function renderAllDayCell(
  cellEl: HTMLElement,
  date: string,
  spans: Task[], // tasks with start && due (multi-day)
  plain: Task[], // tasks with a due-or-scheduled anchor but no time/start (single-day chip)
  deadlines: Task[], // tasks where scheduled is set AND due is set (due renders as marker, not body)
  callbacks: AllDayCallbacks,
  tagGroups: TagGroup[] = [],
): void {
  cellEl.setAttribute('data-tg-date', date);
  (cellEl as unknown as { __tgTestEndDrag?: (targetDate: string) => void }).__tgTestEndDrag = (
    targetDate: string,
  ) => endDragTestHook(cellEl, targetDate);

  for (const t of spans) {
    const bar = renderDraggableBody(cellEl, 'tc-tg-span', t, callbacks, tagGroups);
    // Edge handles: only rendered on the day matching start/due respectively, so
    // dragging one doesn't accidentally exist mid-span.
    if (t.start === date) {
      const leftEdge = bar.createDiv({ cls: 'tc-tg-span-edge tc-tg-span-edge--left' });
      attachEdgeResize(leftEdge, cellEl, t, callbacks.onStartChange);
    }
    if (t.due === date) {
      const rightEdge = bar.createDiv({ cls: 'tc-tg-span-edge tc-tg-span-edge--right' });
      attachEdgeResize(rightEdge, cellEl, t, callbacks.onDueChange);
    }
  }
  for (const t of plain) {
    const chip = renderDraggableBody(cellEl, 'tc-tg-plain', t, callbacks, tagGroups);
    // A plain task has no `start` yet: dragging this handle doesn't just move `due`
    // (there'd be nothing anchoring the other end) — it extends the task into a real
    // multi-day span, so it's wired to onExtendToSpan rather than onDueChange.
    const rightEdge = chip.createDiv({ cls: 'tc-tg-span-edge tc-tg-span-edge--right' });
    attachEdgeResize(rightEdge, cellEl, t, callbacks.onExtendToSpan);
  }
  for (const t of deadlines) {
    const marker = cellEl.createDiv({ cls: 'tc-tg-deadline-marker' });
    // Priority-colored border (color = priority convention); no tag fill — deadline
    // markers stay a compact pill, not a filled colored body (structural distinction).
    if (t.priority !== 'D') marker.setAttribute('data-priority', t.priority);
    renderStatusMarker(marker, {
      task: t,
      registry: callbacks.statusRegistry,
      onLeftClick: () => callbacks.onToggle(t),
      onContextMenu: (ev) => {
        ev.stopPropagation();
        showStatusMenuAt(ev, {
          task: t,
          registry: callbacks.statusRegistry,
          onPickStatus: (c) => callbacks.onSetStatus(t, c),
          onPickPriority: (p) => callbacks.onSetPriority(t, p),
        });
      },
    });
    marker.createSpan({ text: '📅 ' });
    // Task 38 follow-up: same is-done/is-cancelled strikethrough convention as timed blocks
    // and all-day span/plain items above — previously this title had no status class at all.
    const titleEl = marker.createSpan({ cls: `tc-tg-deadline-title${statusTitleClass(t.status)}` });
    renderTaskText(titleEl, t.markdownText, {
      app: callbacks.app,
      sourcePath: t.filePath,
      component: callbacks.component,
    });
    // Count badges only (no tag chips) — deadline markers deliberately stay a compact
    // pill with no tag fill (see comment above), so tag chips would fight that convention.
    if ((t.subtasks?.length ?? 0) > 0 || (t.comments?.length ?? 0) > 0 || (t.linkCount ?? 0) > 0) {
      const meta = marker.createSpan({ cls: 'tc-tg-body-meta' });
      renderCountBadges(meta, t);
    }
    marker.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onTaskClick(t);
    });
  }

  cellEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    cellEl.addClass('is-drag-over');
  });
  cellEl.addEventListener('dragleave', (e) => {
    if (!cellEl.contains(e.relatedTarget as Node)) cellEl.removeClass('is-drag-over');
  });
  cellEl.addEventListener('drop', (e) => {
    e.preventDefault();
    cellEl.removeClass('is-drag-over');
    const dragData = e.dataTransfer?.getData('text/plain');
    if (dragData) callbacks.onDrop(dragData, date);
  });

  if (callbacks.onCreateAtDate) {
    // Click-to-create: fires only for a click on genuinely empty space — not on an existing
    // span/plain/deadline item (dragged/clicked for its own context menu) and not on the
    // quick-add popover CenterPanel renders into this same cell in response. Mirrors
    // HourGrid.ts's onCreateAtTime guard.
    cellEl.addEventListener('click', (e) => {
      if (
        (e.target as HTMLElement).closest(
          '.tc-tg-body, .tc-tg-deadline-marker, .tc-tg-allday-quick-add',
        )
      )
        return;
      callbacks.onCreateAtDate?.(date);
    });
  }
}
