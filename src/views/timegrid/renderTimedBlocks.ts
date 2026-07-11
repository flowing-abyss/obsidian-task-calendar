import { Component, type App } from 'obsidian';
import { formatDurationFromMinutes } from '../../parser/TaskParser';
import type { Task, TaskPriority } from '../../parser/types';
import type { TagGroup } from '../../settings/types';
import type { StatusRegistry } from '../../status/StatusRegistry';
import { tagColorFor } from '../../tags/tagColor';
import { tagFillTextColorVar } from '../../tags/tagFillContrast';
import { renderStatusMarker } from '../../ui/StatusMarker';
import { renderTaskText } from '../../ui/renderTaskText';
import { showStatusMenuAt } from '../../ui/statusMenu';
import {
  capContinuationMinHeightsPx,
  capMinHeightsPx,
  MIN_BLOCK_HEIGHT_PX,
  minutesToPixels,
  minutesToTimeString,
  packOverlaps,
  snapMinutes,
  timeStringToMinutes,
  type TimedBlockInput,
} from './layout';
import { hasCountBadges, renderCountBadges } from './renderTaskMeta';

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
  /** Task 34: horizontal left-edge drag-resize, moving/adding `start` while `due`/`⏰`/`⏱️`
   * stay untouched. Same mutation as renderAllDay.ts's onStartChange/CenterPanel's
   * updateTaskStart — reused as-is: whether the task already has a `start` (moved directly)
   * or not (a fresh 🛫 is appended, anchored on the task's own unmoved `due`), `due` is never
   * part of this mutation's `build()` closure, so it can't be touched by it either way. */
  onStartChange: (task: Task, newStart: string) => void;
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

/**
 * Task 38: `is-done`/`is-cancelled` suffix mirroring ListView.ts's renderListTask statusClass
 * convention — shared by the anchor block's title and the continuation segment's title so a
 * completed/cancelled task reads the same (struck-through) wherever it renders.
 */
function statusTitleClass(status: Task['status']): string {
  if (status === 'done') return ' is-done';
  if (status === 'cancelled') return ' is-cancelled';
  return '';
}

/**
 * Task 37: shared `Task[]` -> `TimedBlockInput[]` conversion, factored out of
 * `renderTimedBlocksForDay` so callers (WeekTimeGridView.ts/TodayView.ts) can build the same
 * `startMinutes`/`durationMinutes` shape for a day's anchor blocks and hand it to
 * `renderTimedSpanContinuation`'s `otherBlocks` parameter — letting a continuation segment's
 * min-height clamp see the anchor block(s) sharing its day column, not just other continuations.
 */
export function toTimedBlockInputs(tasks: Task[]): TimedBlockInput[] {
  return tasks.map((t) => ({
    task: t,
    startMinutes: timeStringToMinutes(t.time ?? '00:00'),
    durationMinutes: t.duration ?? DEFAULT_DURATION_MINUTES,
  }));
}

export function renderTimedBlocksForDay(
  hourColumnEl: HTMLElement,
  tasksWithTime: Task[],
  callbacks: TimedBlockCallbacks,
  tagGroups: TagGroup[] = [],
): void {
  const inputs: TimedBlockInput[] = toTimedBlockInputs(tasksWithTime);
  const positioned = packOverlaps(inputs);
  // Task 36: `.tc-tg-block`'s CSS min-height keeps a short block's checkbox+title row legible,
  // but only ever grows a block past its duration-derived height — see capMinHeightsPx's own
  // doc comment for why a same-column neighbor can still need that growth clamped back down so
  // the two blocks never visually cross.
  const minHeightCaps = capMinHeightsPx(positioned);

  for (const p of positioned) {
    const widthPct = 100 / p.columns;
    const block = hourColumnEl.createDiv({ cls: 'tc-tg-block' });
    // Task 39: makes the block a native keyboard-focus target (Tab/Shift+Tab reach it, click
    // focuses it) so attachKeyboardNudge's arrow-key handling below has something to hang off
    // — see that function's own doc comment for why this stays scoped to "has native DOM
    // focus" rather than a broader "selected task" concept.
    block.setAttribute('tabindex', '0');
    block.style.top = `${minutesToPixels(p.startMinutes)}px`;
    const heightPx = minutesToPixels(p.durationMinutes);
    block.style.height = `${heightPx}px`;
    // Only intervene when the CSS min-height would otherwise cross into the next same-column
    // block — leave the CSS rule (which uses real `em`s, more accurate than this JS-side
    // approximation) in full effect everywhere else.
    const cap = minHeightCaps.get(p) ?? Infinity;
    if (cap < MIN_BLOCK_HEIGHT_PX) {
      block.style.minHeight = `${Math.max(heightPx, cap)}px`;
    }
    block.style.width = `${widthPct}%`;
    block.style.left = `${p.column * widthPct}%`;
    // Tag-colored fill only — the priority-colored border was removed (Task 12): the
    // status marker below already conveys priority via its own border, so a second
    // priority border on the block itself was redundant visual noise.
    const tagColor = tagColorFor(p.task.rawText, tagGroups);
    if (tagColor) {
      block.setCssProps({ '--tc-tag-color': tagColor });
      // Task 40 (Round 4): a single fixed var(--text-normal) title/subtitle color (the
      // pre-existing behavior) loses contrast against a bright/pale tag color's fill in light
      // mode, or a very dark/desaturated one in dark mode — see tagFillContrast.ts's own doc
      // comment for the full reasoning. Only set when a variant was actually computed (falls
      // through to the CSS rule's own var(--text-normal) fallback otherwise).
      const textColorVar = tagFillTextColorVar(block, tagColor);
      if (textColorVar) block.setCssProps({ '--tc-tag-text-color': textColorVar });
    }
    // Time-range+duration subtitle renders first (top of the block), e.g. "09:00–11:00 (2h)".
    // Task 35: shares its row with the count-badges container (see below) via `.tc-tg-block-
    // toprow`'s `justify-content: space-between` — real flex layout, not an absolutely
    // positioned overlay, so the badges land in the block's visual top-right corner without
    // ever covering the subtitle text (an earlier absolute-position attempt did overlap it on
    // narrower blocks).
    const topRow = block.createDiv({ cls: 'tc-tg-block-toprow' });
    topRow.createDiv({
      cls: 'tc-tg-block-subtitle',
      text: `${minutesToTimeString(p.startMinutes)}–${minutesToTimeString(p.startMinutes + p.durationMinutes)} (${formatDurationFromMinutes(p.durationMinutes)})`,
    });
    // Task 35: count badges (subtasks/comments/links) only — tag chips were removed entirely
    // for timed blocks (the block's own tag-colored fill, set above, already conveys the tag;
    // a chip repeating it was redundant). Skipped entirely when the task has no counts, so a
    // plain/tag-only task doesn't gain an empty container. Non-interactive (see
    // renderTaskMeta.ts) — safe to sit inside the block without needing the pointerdown
    // exclusion-guard below.
    if (hasCountBadges(p.task)) {
      const badges = topRow.createDiv({ cls: 'tc-tg-block-badges' });
      renderCountBadges(badges, p.task);
    }
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
    // Task 38: a completed/cancelled task stays a full, visible block (checkbox showing its
    // checked state via the marker above), communicating completion purely through this
    // strikethrough title instead of disappearing.
    const titleEl = head.createDiv({
      cls: `tc-tg-block-title${statusTitleClass(p.task.status)}`,
    });
    renderTaskText(titleEl, p.task.markdownText, {
      app: callbacks.app,
      sourcePath: p.task.filePath,
      component: callbacks.component,
    });
    // Task 34: left-edge horizontal resize, moving/adding `start` while `due`/`⏰`/`⏱️` stay
    // untouched (see TimedBlockCallbacks.onStartChange's own comment). Rendered on the same
    // anchor-day block as the right edge below — unlike renderAllDay.ts's all-day spans, where
    // start and due each get their own handle on their own (usually different) day cell, a
    // timed span's only ever-interactive block is its `due`-anchored one (see this function's
    // own doc comment on the due-centric anchor rule), so both edges of a timed span necessarily
    // coexist on the same element here.
    const hEdgeLeft = block.createDiv({ cls: 'tc-tg-span-edge tc-tg-span-edge--left' });
    attachHorizontalResize(hEdgeLeft, hourColumnEl, p.task, callbacks.onStartChange);
    // Task 29: right-edge horizontal resize, extending the block into a multi-day timed span.
    // Reuses `.tc-tg-span-edge`/`.tc-tg-span-edge--right` — the same classes/CSS renderAllDay.ts's
    // span/plain right-edge handles already use — so it looks and behaves consistently with the
    // existing all-day span-extension affordance (Round 2 Task 9) instead of inventing new visual
    // language for the same gesture.
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
    // Task 39: keyboard nudge. This codebase has no pre-existing "selected task" concept to
    // hang this off, and building one is a larger architectural change than this task's scope
    // — per the brief's own explicit permission to narrow, this is scoped to native DOM focus:
    // give the block `tabindex="0"` and nudge its time by one snap increment (the same
    // SNAP_MINUTES the pointer-drag/live-preview above already use) while it has focus, up =
    // earlier, down = later. Routes through the SAME `onTimeChange` callback pointer-drag
    // commits through (Task 33's `applyValidatedLineMutation` safety net lives one layer up, in
    // whatever wires `onTimeChange` — see CenterPanel.ts's `handleTimeChange` — so this
    // inherits it automatically rather than needing its own mutation path).
    attachKeyboardNudge(block, p.startMinutes, callbacks, p.task);
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
 *
 * Task 35 (expanded scope): also shows the same time-range+duration subtitle and count badges
 * (subtasks/comments/links) the anchor block shows, so a continuation segment reads as more than
 * just a title bar — but stays purely presentational: no checkbox, and neither the subtitle nor
 * the badges container gets a click/drag handler, so this remains as non-interactive as before.
 *
 * Task 37: like `.tc-tg-block`, `.tc-tg-block-continuation` has a CSS min-height that keeps a
 * short segment's title legible — but, unlike anchor blocks, continuation segments never go
 * through `packOverlaps`'s column-collision avoidance (they're always rendered full-width, one
 * per task). `capContinuationMinHeightsPx` closes that gap: `otherBlocks` lets a caller pass the
 * SAME day's already-positioned anchor blocks (see `toTimedBlockInputs`) so a continuation's
 * min-height growth is clamped against those too, not just other continuations.
 */
export function renderTimedSpanContinuation(
  hourColumnEl: HTMLElement,
  tasks: Task[],
  onTaskClick?: (task: Task) => void,
  tagGroups: TagGroup[] = [],
  otherBlocks: TimedBlockInput[] = [],
): void {
  const continuationInputs = toTimedBlockInputs(tasks);
  const minHeightCaps = capContinuationMinHeightsPx(continuationInputs, otherBlocks);
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    const continuationInput = continuationInputs[i]!;
    const { startMinutes, durationMinutes } = continuationInput;
    const seg = hourColumnEl.createDiv({ cls: 'tc-tg-block-continuation' });
    seg.style.top = `${minutesToPixels(startMinutes)}px`;
    const heightPx = minutesToPixels(durationMinutes);
    seg.style.height = `${heightPx}px`;
    // Mirrors renderTimedBlocksForDay's own use of capMinHeightsPx exactly: only intervene when
    // the CSS min-height would otherwise cross into whatever's next in this day column.
    const cap = minHeightCaps.get(continuationInput) ?? Infinity;
    if (cap < MIN_BLOCK_HEIGHT_PX) {
      seg.style.minHeight = `${Math.max(heightPx, cap)}px`;
    }
    const tagColor = tagColorFor(t.rawText, tagGroups);
    if (tagColor) {
      seg.setCssProps({ '--tc-tag-color': tagColor });
      // Task 40 (Round 4): same contrast-driven text-color fix as the anchor block above,
      // applied to the continuation segment's own (lighter, 22%-mix) fill — the 22% here
      // matches .tc-tg-block-continuation's own color-mix percentage in styles.css.
      const textColorVar = tagFillTextColorVar(seg, tagColor, 22);
      if (textColorVar) seg.setCssProps({ '--tc-tag-text-color': textColorVar });
    }
    const topRow = seg.createDiv({ cls: 'tc-tg-block-toprow' });
    topRow.createDiv({
      cls: 'tc-tg-block-subtitle',
      text: `${minutesToTimeString(startMinutes)}–${minutesToTimeString(startMinutes + durationMinutes)} (${formatDurationFromMinutes(durationMinutes)})`,
    });
    if (hasCountBadges(t)) {
      const badges = topRow.createDiv({ cls: 'tc-tg-block-badges' });
      renderCountBadges(badges, t);
    }
    // Task 38: mirrors the anchor block's is-done/is-cancelled title convention above — a
    // continuation segment renders the same underlying task, so it must reflect completion the
    // same way rather than looking untouched while its anchor block elsewhere shows struck-through.
    seg.createSpan({
      cls: `tc-tg-block-continuation-title${statusTitleClass(t.status)}`,
      text: t.markdownText,
    });
    if (onTaskClick) {
      seg.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onTaskClick(t);
      });
    }
  }
}

/**
 * Task 39: keyboard nudge — ArrowUp/ArrowDown move the block's start time earlier/later by one
 * `SNAP_MINUTES` increment, exactly mirroring the pointer-drag's own snap step, while the block
 * has native DOM focus (see `tabindex="0"` set on it above). Scoped deliberately narrow: this
 * codebase has no "selected task" concept broader than "which element currently has focus", and
 * introducing one is a bigger architectural change than this task's brief calls for — the brief
 * explicitly permits narrowing to native focus alone, so a blur (clicking/tabbing elsewhere)
 * simply stops the block from responding to arrow keys, same as any other focusable control.
 *
 * `e.target !== block` guards against a bubbled keydown from some future focusable descendant
 * (none exist today — the status marker, title links, and resize handles are none of them
 * currently focusable — but this keeps the handler scoped to exactly the element that owns the
 * `tabindex`, not "anything inside it", matching this file's other pointerdown handlers' own
 * `closest()`-based scoping discipline).
 *
 * Reuses `callbacks.onTimeChange` — the SAME callback the vertical pointer-drag commits
 * through — so this automatically inherits whatever mutation path that's wired to (in practice,
 * CenterPanel.ts's `handleTimeChange` -> `updateTaskTime` -> `TaskMutationService`'s
 * `applyValidatedLineMutation`, Task 33's validate-before-write safety net) without needing its
 * own mutation call here.
 */
function attachKeyboardNudge(
  block: HTMLElement,
  currentStartMinutes: number,
  callbacks: TimedBlockCallbacks,
  task: Task,
): void {
  block.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target !== block) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? -SNAP_MINUTES : SNAP_MINUTES;
    const next = Math.min(MAX_START_MINUTES, Math.max(0, currentStartMinutes + delta));
    callbacks.onTimeChange(task, next);
  });
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
    // Task 39: mirrors is-dragging/is-edge-resizing's own cleanup-in-every-exit-path
    // discipline — removed here (the one place every exit path funnels through) rather than
    // only in onPointerUp, so a pointercancel mid-gesture (native drag hijacking the pointer
    // session, see onPointerCancel below) can never leave the "picked up" affordance stuck on.
    block.removeClass('is-picked-up');
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
    // Task 39: immediate "picked up" affordance for a move-mode drag specifically (not
    // resize) — the user's most common gesture is grabbing the block body to reschedule it,
    // and it previously gave zero feedback that anything had been armed until the block
    // visibly moved on the next pointermove. `.is-dragging` (Task 26) is deliberately NOT
    // reused here: that class fires from `dragstart`/`dragend`, native HTML5 DnD events that
    // only occur once the browser has taken over the pointer session for the drag-to-all-day
    // gesture (dozens of ms after this pointerdown, and never at all for an ordinary
    // vertical move that stays inside the hour grid) — reusing it here would either double
    // up if a native drag DID start, or never fire for the common in-grid case it's meant to
    // cover. A distinct class keeps the two mechanisms' visual language independently
    // tunable, same reasoning Task 37 used to give edge-resize its own `.is-edge-resizing`
    // instead of overloading `.is-dragging`.
    if (mode === 'move') block.addClass('is-picked-up');
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
 * Task 34: also used for the left edge (moves/adds `start`) — both edges share this same
 * mechanics function, differing only in which mutation callback `onResolve` invokes on
 * resolution, mirroring how renderAllDay.ts's single `attachEdgeResize` already serves its
 * left/right/plain-right handles alike.
 */
function attachHorizontalResize(
  handle: HTMLElement,
  hourColumnEl: HTMLElement,
  task: Task,
  onResolve: (task: Task, newDate: string) => void,
): void {
  // Same reasoning as the vertical resize handle's draggable="false" (Task 26): this handle is a
  // non-draggable island inside the block's draggable="true" ancestor, so a gesture starting here
  // never races the block's own native dragstart.
  handle.setAttribute('draggable', 'false');

  const resolve = (date: string): void => {
    onResolve(task, date);
  };

  const withHook = hourColumnEl as HTMLElement & {
    __tgPendingEdgeResizes?: Array<(d: string) => void>;
  };

  // Task 39: live feedback for horizontal (day-crossing) edge-resize, which — unlike the
  // vertical move/resize drag above — had NO visual feedback at all while dragging, only a
  // commit-on-release (see this function's own doc comment). The commit itself already
  // resolves which day the pointer is over via `elementFromPoint` on release; this surfaces
  // that same resolution live, on every pointermove, by toggling `.is-drag-over` on whichever
  // `[data-tg-date]` day column is currently under the pointer — reusing the day cell's
  // existing native-DnD dragover highlight (renderAllDay.ts) rather than inventing a new
  // convention, since both signal the same thing: "this is the day you'd land on if you let
  // go now." `hoveredDayEl` tracks the currently-highlighted column so a fast drag across
  // several columns only ever has one column highlighted at a time.
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

  // Task 34: unlike Task 29 (where this was the ONLY horizontal handle sharing
  // `hourColumnEl`'s `__tgPendingEdgeResizes` array), a block now carries both a left and a
  // right edge handle registered against the SAME hourColumnEl — so `resolve` is pushed/removed
  // here around the armed window (pointerdown→pointerup/cancel) rather than unconditionally at
  // attach time. Otherwise `__tgTestEndDrag` (and, in principle, a stray real pointerup with no
  // matching pointerdown) would resolve BOTH edges' callbacks instead of only the one actually
  // being dragged.
  const unregisterPending = (): void => {
    const pending = withHook.__tgPendingEdgeResizes;
    if (!pending) return;
    const idx = pending.indexOf(resolve);
    if (idx !== -1) pending.splice(idx, 1);
  };

  const cleanup = (): void => {
    clearHoveredDay();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    unregisterPending();
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
    withHook.__tgPendingEdgeResizes = withHook.__tgPendingEdgeResizes ?? [];
    withHook.__tgPendingEdgeResizes.push(resolve);
  });

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
