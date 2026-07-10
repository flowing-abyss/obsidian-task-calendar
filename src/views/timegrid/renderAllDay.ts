import { Component, type App } from 'obsidian';
import type { Task } from '../../parser/types';
import type { TagGroup } from '../../settings/types';
import type { StatusRegistry } from '../../status/StatusRegistry';
import { tagColorFor } from '../../tags/tagColor';
import { renderStatusMarker } from '../../ui/StatusMarker';
import { renderTaskText } from '../../ui/renderTaskText';

export interface AllDayCallbacks {
  app: App;
  component: Component;
  onTaskClick: (task: Task) => void;
  onDrop: (dragData: string, targetDate: string) => void; // native HTML5 DnD, existing convention
  onStartChange: (task: Task, newStart: string) => void; // pointer edge-resize
  onDueChange: (task: Task, newDue: string) => void; // pointer edge-resize
  onExtendToSpan: (task: Task, newDue: string) => void; // pointer edge-resize on a plain task
  onToggle: (task: Task) => void;
  statusRegistry: StatusRegistry;
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
  // click handler stops propagation; its contextmenu handler does NOT, so a right-click on
  // the marker still bubbles to this element's contextmenu below (opens modal).
  renderStatusMarker(el, {
    task,
    registry: callbacks.statusRegistry,
    onLeftClick: () => callbacks.onToggle(task),
    onContextMenu: () => {},
  });
  const titleEl = el.createSpan();
  renderTaskText(titleEl, task.markdownText, {
    app: callbacks.app,
    sourcePath: task.filePath,
    component: callbacks.component,
  });
  // Tag-colored fill only — the priority-colored border was removed (Task 12): the
  // status marker above already conveys priority via its own border, so a second
  // priority border on the body was redundant visual noise.
  const tagColor = tagColorFor(task.rawText, tagGroups);
  if (tagColor) el.setCssProps({ '--tc-tag-color': tagColor });
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
  // whole-task cross-day move). Without opting the handle itself out, a mousedown+drag
  // gesture starting on the handle could arm the ancestor's native HTML5 dragstart at
  // the same time as this pointer-based resize — draggable="false" here (the standard
  // technique for a non-draggable island inside a draggable element) keeps the two
  // gestures from racing.
  handle.setAttribute('draggable', 'false');

  const resolve = (date: string): void => {
    onResolve(task, date);
  };

  const onPointerMove = (e: PointerEvent): void => {
    e.preventDefault();
  };

  const onPointerUp = (upEvent: PointerEvent): void => {
    const target = activeDocument.elementFromPoint(upEvent.clientX, upEvent.clientY);
    const dayEl = target?.closest('[data-tg-date]');
    const date = dayEl?.getAttribute('data-tg-date');
    if (date) resolve(date);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
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
      onContextMenu: () => {},
    });
    marker.createSpan({ text: '📅 ' });
    const titleEl = marker.createSpan();
    renderTaskText(titleEl, t.markdownText, {
      app: callbacks.app,
      sourcePath: t.filePath,
      component: callbacks.component,
    });
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
}
