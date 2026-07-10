import type { Task } from '../../parser/types';
import type { TagGroup } from '../../settings/types';
import type { StatusRegistry } from '../../status/StatusRegistry';
import { tagColorFor } from '../../tags/tagColor';
import { renderStatusMarker } from '../../ui/StatusMarker';

export interface AllDayCallbacks {
  onTaskClick: (task: Task) => void;
  onDrop: (dragData: string, targetDate: string) => void; // native HTML5 DnD, existing convention
  onStartChange: (task: Task, newStart: string) => void; // pointer edge-resize
  onDueChange: (task: Task, newDue: string) => void; // pointer edge-resize
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
  el.createSpan({ text: task.text });
  // Priority-colored left border (color = priority convention) + tag-colored fill.
  if (task.priority !== 'D') el.setAttribute('data-priority', task.priority);
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
 * Attach pointer-based edge-resize to a span's start/due handle. In real usage the
 * pointerup handler resolves the date under the pointer via `activeDocument.elementFromPoint`,
 * finding the nearest ancestor with `data-tg-date` (stamped by whichever `renderAllDayCell`
 * call rendered that day column). Also registers a direct-invocation callback on `cellEl`
 * for the jsdom test seam (see `endDragTestHook`).
 */
function attachEdgeResize(
  handle: HTMLElement,
  cellEl: HTMLElement,
  task: Task,
  edge: 'start' | 'due',
  callbacks: AllDayCallbacks,
): void {
  const resolve = (date: string): void => {
    if (edge === 'start') callbacks.onStartChange(task, date);
    else callbacks.onDueChange(task, date);
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
      attachEdgeResize(leftEdge, cellEl, t, 'start', callbacks);
    }
    if (t.due === date) {
      const rightEdge = bar.createDiv({ cls: 'tc-tg-span-edge tc-tg-span-edge--right' });
      attachEdgeResize(rightEdge, cellEl, t, 'due', callbacks);
    }
  }
  for (const t of plain) {
    renderDraggableBody(cellEl, 'tc-tg-plain', t, callbacks, tagGroups);
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
    marker.createSpan({ text: `📅 ${t.text}` });
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
