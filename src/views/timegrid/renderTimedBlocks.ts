import { Component, type App } from 'obsidian';
import { formatDurationFromMinutes } from '../../parser/TaskParser';
import type { Task, TaskPriority } from '../../parser/types';
import type { TagGroup } from '../../settings/types';
import type { StatusRegistry } from '../../status/StatusRegistry';
import { tagColorFor } from '../../tags/tagColor';
import { renderStatusMarker } from '../../ui/StatusMarker';
import { renderTaskText } from '../../ui/renderTaskText';
import { showStatusMenuAt } from '../../ui/statusMenu';
import {
  minutesToPixels,
  minutesToTimeString,
  packOverlaps,
  snapMinutes,
  timeStringToMinutes,
  type TimedBlockInput,
} from './layout';
import { hasMeta, renderCountBadges, renderTagChips } from './renderTaskMeta';

export interface TimedBlockCallbacks {
  app: App;
  component: Component;
  onTaskClick: (task: Task) => void;
  onTimeChange: (task: Task, newStartMinutes: number) => void;
  onDurationChange: (task: Task, newDurationMinutes: number) => void;
  /** Task 29: horizontal right-edge drag-resize, extending the block into a multi-day timed
   * span. Same mutation as renderAllDay.ts's onExtendToSpan (freezes the original `due` as
   * `start`, moves `due` to the dragged-to date) — reused as-is since it already leaves
   * `⏰`/`⏱️` untouched, which is exactly what preserving the task's time/duration needs. */
  onExtendToSpan: (task: Task, newDue: string) => void;
  onToggle: (task: Task) => void;
  onSetStatus: (task: Task, status: string) => void;
  onSetPriority: (task: Task, priority: TaskPriority) => void;
  statusRegistry: StatusRegistry;
}

const DEFAULT_DURATION_MINUTES = 60;
const SNAP_MINUTES = 15;
// Task 33: hard bounds on drag-computed move/resize values. Neither `onTimeChange` nor
// `onDurationChange` touches the task's date — only its time-of-day/duration — so a vertical
// drag was previously left completely unclamped on the upper end (only `Math.max(0, ...)` /
// `Math.max(SNAP_MINUTES, ...)` guarded the lower end). Root cause of the disappearing-task bug:
// an extreme drag (e.g. the pointer released far outside the visible grid) could compute a start
// time whose hour needs 3+ digits (e.g. "2093:15") — `⏰`'s own `\d{1,2}` grammar can't match
// that, so the token silently fails to round-trip through the parser on the next read, `time`
// comes back `undefined`, and the task drops out of every time-based view while the garbage text
// leaks into the visible title. Clamping here keeps every value this module ever *computes*
// inside a single real calendar day, so it can never produce that class of value in the first
// place — the safety net in `TaskMutationService.applyValidatedLineMutation` is the last line of
// defense for anything that still slips through (a different future bug, manual data corruption,
// etc.), not the first one.
const MAX_START_MINUTES = 24 * 60 - SNAP_MINUTES; // 23:45 — the last valid quarter-hour slot.
const MAX_DURATION_MINUTES = 24 * 60; // A full day is already a generous, unambiguous cap.

export function renderTimedBlocksForDay(
  hourColumnEl: HTMLElement,
  tasksWithTime: Task[],
  callbacks: TimedBlockCallbacks,
  tagGroups: TagGroup[] = [],
): void {
  const inputs: TimedBlockInput[] = tasksWithTime.map((t) => ({
    task: t,
    startMinutes: timeStringToMinutes(t.time ?? '00:00'),
    durationMinutes: t.duration ?? DEFAULT_DURATION_MINUTES,
  }));
  const positioned = packOverlaps(inputs);

  for (const p of positioned) {
    const widthPct = 100 / p.columns;
    const block = hourColumnEl.createDiv({ cls: 'tc-tg-block' });
    block.style.top = `${minutesToPixels(p.startMinutes)}px`;
    block.style.height = `${minutesToPixels(p.durationMinutes)}px`;
    block.style.width = `${widthPct}%`;
    block.style.left = `${p.column * widthPct}%`;
    // Tag-colored fill only — the priority-colored border was removed (Task 12): the
    // status marker below already conveys priority via its own border, so a second
    // priority border on the block itself was redundant visual noise.
    const tagColor = tagColorFor(p.task.rawText, tagGroups);
    if (tagColor) block.setCssProps({ '--tc-tag-color': tagColor });
    // Time-range+duration subtitle renders first (top of the block), e.g. "09:00–11:00 (2h)".
    block.createDiv({
      cls: 'tc-tg-block-subtitle',
      text: `${minutesToTimeString(p.startMinutes)}–${minutesToTimeString(p.startMinutes + p.durationMinutes)} (${formatDurationFromMinutes(p.durationMinutes)})`,
    });
    // Status marker + title share one flex row so the checkbox and title render on the
    // same line instead of stacking (the title div is block-level, which previously
    // forced a line break after the inline marker span).
    const head = block.createDiv({ cls: 'tc-tg-block-head' });
    // Status marker first: lets a user mark the block done without opening the modal.
    // Its own contextmenu handler stops propagation and opens the status/priority popover
    // instead — distinct from right-clicking the block body below (opens the task modal).
    renderStatusMarker(head, {
      task: p.task,
      registry: callbacks.statusRegistry,
      onLeftClick: () => callbacks.onToggle(p.task),
      onContextMenu: (ev) => {
        ev.stopPropagation();
        showStatusMenuAt(ev, {
          task: p.task,
          registry: callbacks.statusRegistry,
          onPickStatus: (c) => callbacks.onSetStatus(p.task, c),
          onPickPriority: (pr) => callbacks.onSetPriority(p.task, pr),
        });
      },
    });
    const titleEl = head.createDiv({ cls: 'tc-tg-block-title' });
    renderTaskText(titleEl, p.task.markdownText, {
      app: callbacks.app,
      sourcePath: p.task.filePath,
      component: callbacks.component,
    });
    // Tag chips + count badges (subtasks/comments/links), matching TaskCard/CenterPanel's
    // visual language. Skipped entirely when the task has neither, so a plain task doesn't
    // gain an empty row. Non-interactive (see renderTaskMeta.ts) — safe to sit inside the
    // block without needing the pointerdown exclusion-guard below.
    if (hasMeta(p.task)) {
      const meta = block.createDiv({ cls: 'tc-tg-block-meta' });
      renderCountBadges(meta, p.task);
      renderTagChips(meta, p.task, tagGroups);
    }
    // Task 29: right-edge horizontal resize, extending the block into a multi-day timed span.
    // Reuses `.tc-tg-span-edge`/`.tc-tg-span-edge--right` — the same classes/CSS renderAllDay.ts's
    // span/plain right-edge handles already use — so it looks and behaves consistently with the
    // existing all-day span-extension affordance (Round 2 Task 9) instead of inventing new visual
    // language for the same gesture. Left-edge is deliberately NOT implemented (scope cut, see
    // Task 29's brief and the commit message — only the right edge ships).
    const hEdge = block.createDiv({ cls: 'tc-tg-span-edge tc-tg-span-edge--right' });
    attachHorizontalResize(hEdge, hourColumnEl, p.task, callbacks.onExtendToSpan);

    const handle = block.createDiv({ cls: 'tc-tg-resize-handle' });
    // Task 26: native HTML5 DnD so a timed block can be dragged out of the hour-grid onto the
    // all-day/"No-time" row (renderAllDay.ts's existing drop target), using the SAME
    // filePath:::line payload convention as renderAllDay.ts's renderDraggableBody. The resize
    // handle stays draggable="false" — the identical defensive pattern renderAllDay.ts's
    // attachEdgeResize already established (Round 2 Task 9) for a non-draggable island inside a
    // draggable ancestor, so a resize gesture starting on the handle never races the block's own
    // native dragstart.
    block.setAttribute('draggable', 'true');
    handle.setAttribute('draggable', 'false');
    block.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', `${p.task.filePath}:::${p.task.line}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      block.addClass('is-dragging');
    });
    block.addEventListener('dragend', () => block.removeClass('is-dragging'));

    block.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if ((e.target as HTMLElement).closest('.tc-tg-resize-handle, .tc-tg-span-edge')) return;
      callbacks.onTaskClick(p.task);
    });

    attachDrag(block, handle, p.startMinutes, p.durationMinutes, callbacks, p.task);
  }
}

/**
 * Task 29: renders the lighter, non-interactive "continuation" segment for a non-anchor day of
 * a multi-day timed span (`start` < `due`, `time` set) — the anchor day (matching `due`, per
 * this project's due-centric anchor-priority rule) gets the full interactive block via
 * `renderTimedBlocksForDay` instead; every OTHER day the span covers gets this instead, so the
 * same task never renders two full interactive blocks across a Week view.
 *
 * Deliberately minimal — no checkbox, no drag, no resize handles, no markdown-link-aware title
 * rendering (a plain textContent title, unlike the anchor block's renderTaskText) — visually
 * similar in spirit to MonthGridView's existing `.tc-mg-span-segment` continuation bars for
 * untimed spans: clearly linked to the task (same title, tag color, time-of-day position) but
 * unmistakably not a second interactive copy of it. A contextmenu still opens the task modal
 * (`onTaskClick`), same as a full block, since that's a read-only action.
 */
export function renderTimedSpanContinuation(
  hourColumnEl: HTMLElement,
  tasks: Task[],
  onTaskClick?: (task: Task) => void,
  tagGroups: TagGroup[] = [],
): void {
  for (const t of tasks) {
    const startMinutes = timeStringToMinutes(t.time ?? '00:00');
    const durationMinutes = t.duration ?? DEFAULT_DURATION_MINUTES;
    const seg = hourColumnEl.createDiv({ cls: 'tc-tg-block-continuation' });
    seg.style.top = `${minutesToPixels(startMinutes)}px`;
    seg.style.height = `${minutesToPixels(durationMinutes)}px`;
    const tagColor = tagColorFor(t.rawText, tagGroups);
    if (tagColor) seg.setCssProps({ '--tc-tag-color': tagColor });
    seg.createSpan({ cls: 'tc-tg-block-continuation-title', text: t.markdownText });
    if (onTaskClick) {
      seg.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onTaskClick(t);
      });
    }
  }
}

function attachDrag(
  block: HTMLElement,
  handle: HTMLElement,
  initialStart: number,
  initialDuration: number,
  callbacks: TimedBlockCallbacks,
  task: Task,
): void {
  let mode: 'move' | 'resize' | null = null;
  let startY = 0;
  let startMinutes = initialStart;
  let startDuration = initialDuration;

  const onPointerMove = (e: PointerEvent): void => {
    if (!mode) return;
    const rawDelta = ((e.clientY - startY) / minutesToPixels(60)) * 60;
    const deltaMinutes = snapMinutes(rawDelta, SNAP_MINUTES);
    if (mode === 'move') {
      const next = Math.min(MAX_START_MINUTES, Math.max(0, startMinutes + deltaMinutes));
      block.style.top = `${minutesToPixels(next)}px`;
    } else {
      const next = Math.min(
        MAX_DURATION_MINUTES,
        Math.max(SNAP_MINUTES, startDuration + deltaMinutes),
      );
      block.style.height = `${minutesToPixels(next)}px`;
    }
  };

  const cleanup = (): void => {
    mode = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!mode) return;
    const rawDelta = ((e.clientY - startY) / minutesToPixels(60)) * 60;
    const deltaMinutes = snapMinutes(rawDelta, SNAP_MINUTES);
    if (mode === 'move') {
      callbacks.onTimeChange(
        task,
        Math.min(MAX_START_MINUTES, Math.max(0, startMinutes + deltaMinutes)),
      );
    } else {
      callbacks.onDurationChange(
        task,
        Math.min(MAX_DURATION_MINUTES, Math.max(SNAP_MINUTES, startDuration + deltaMinutes)),
      );
    }
    cleanup();
  };

  // Now that the block is also draggable="true" (native HTML5 DnD, for dragging out to the
  // all-day row), a pointerdown that arms move/resize can be hijacked mid-gesture by the
  // browser starting a native drag: per the Pointer Events spec, once native DnD takes over the
  // pointer session it fires `pointercancel` instead of `pointerup` for that pointer. Without
  // this handler, `mode` and the window pointermove/pointerup listeners from the aborted
  // gesture would never be torn down — leaking listeners that would double-fire on the next
  // real gesture — and no mutation must fire here (the drop is handled by the native DnD
  // dragend/drop path instead, not this pointer session).
  const onPointerCancel = (): void => {
    if (!mode) return;
    cleanup();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    // A pointerdown that starts on the status marker or a rendered markdown link must never
    // arm move/resize — otherwise a plain checkbox click, or a click that navigates a
    // [[wikilink]]/markdown link in the title, also fires onTimeChange/onDurationChange as an
    // unwanted side effect (pointerdown→pointerup fires and completes before the marker's own
    // click handler runs onToggle, or before the link's own click handler navigates). Mirrors
    // the existing resize-handle exclusion below. `a` covers renderTaskText's rendered links —
    // matched by tag, not a task-calendar-specific class, since MarkdownRenderer owns that markup.
    // `.tc-tg-span-edge` (Task 29's horizontal resize handle) is excluded too: it has its own
    // dedicated pointerdown listener (attachHorizontalResize) that stops propagation before this
    // block-level listener would ever see it, so this closest() never actually matches in
    // practice — kept as a defensive, explicit belt-and-suspenders guard rather than relying
    // solely on stopPropagation ordering.
    if ((e.target as HTMLElement).closest('.tc-status-marker, a, .tc-tg-span-edge')) return;
    mode = (e.target as HTMLElement).closest('.tc-tg-resize-handle') ? 'resize' : 'move';
    startY = e.clientY;
    startMinutes = initialStart;
    startDuration = initialDuration;
    e.stopPropagation();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  block.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointerdown', onPointerDown);
}

/**
 * Task 29: right-edge horizontal drag-resize, extending a timed block into a multi-day timed
 * span. Mirrors renderAllDay.ts's `attachEdgeResize` exactly (same Pointer-Events pattern: no
 * live visual feedback while dragging, just a commit-on-release that resolves the day under the
 * pointer) rather than inventing a new interaction style — the day boundary crossing is resolved
 * from the pointer's final (clientX, clientY) via `activeDocument.elementFromPoint`, walking up
 * to the nearest `[data-tg-date]` ancestor (HourGrid.ts's `.tc-tg-day-column`, one per rendered
 * date), NOT by accumulating a per-pixel delta within a single column — so dragging across 2-3
 * day columns resolves to whichever column the pointer is over at release, however far that is.
 *
 * `hourColumnEl` (the per-day column this block was rendered into) doubles as the test seam
 * anchor: real usage never reads from it directly, but jsdom's `elementFromPoint` always returns
 * null, so tests drive the same deterministic `__tgPendingEdgeResizes`/`__tgTestEndDrag` seam
 * renderAllDay.ts established (Round 2 Task 9), registered here per-day-column instead of
 * per-all-day-cell.
 *
 * Left-edge resize is a deliberate scope cut for this task (see Task 29's brief) — only the
 * right edge is implemented.
 */
function attachHorizontalResize(
  handle: HTMLElement,
  hourColumnEl: HTMLElement,
  task: Task,
  onExtendToSpan: (task: Task, newDue: string) => void,
): void {
  // Same reasoning as the vertical resize handle's draggable="false" (Task 26): this handle is a
  // non-draggable island inside the block's draggable="true" ancestor, so a gesture starting here
  // never races the block's own native dragstart.
  handle.setAttribute('draggable', 'false');

  const resolve = (date: string): void => {
    onExtendToSpan(task, date);
  };

  const onPointerMove = (e: PointerEvent): void => {
    e.preventDefault();
  };

  const cleanup = (): void => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };

  const onPointerUp = (upEvent: PointerEvent): void => {
    const target = activeDocument.elementFromPoint(upEvent.clientX, upEvent.clientY);
    const dayEl = target?.closest('[data-tg-date]');
    const date = dayEl?.getAttribute('data-tg-date');
    if (date) resolve(date);
    cleanup();
  };

  // Same rationale as attachDrag's onPointerCancel above: the block this handle sits inside is
  // draggable="true" (Task 26), so a native drag hijacking the pointer session mid-gesture fires
  // pointercancel instead of pointerup — without this, the window pointermove/pointerup listeners
  // registered below would leak.
  const onPointerCancel = (): void => {
    cleanup();
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  });

  const withHook = hourColumnEl as HTMLElement & {
    __tgPendingEdgeResizes?: Array<(d: string) => void>;
  };
  withHook.__tgPendingEdgeResizes = withHook.__tgPendingEdgeResizes ?? [];
  withHook.__tgPendingEdgeResizes.push(resolve);

  const withEndDrag = hourColumnEl as unknown as {
    __tgTestEndDrag?: (targetDate: string) => void;
  };
  if (!withEndDrag.__tgTestEndDrag) {
    withEndDrag.__tgTestEndDrag = (targetDate: string) => {
      const pending = (
        hourColumnEl as unknown as { __tgPendingEdgeResizes?: Array<(d: string) => void> }
      ).__tgPendingEdgeResizes;
      pending?.forEach((cb) => cb(targetDate));
    };
  }
}
