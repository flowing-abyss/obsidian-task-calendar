import { Component, type App } from 'obsidian';
import { formatDurationFromMinutes } from '../../parser/TaskParser';
import type { Task } from '../../parser/types';
import type { TagGroup } from '../../settings/types';
import type { StatusRegistry } from '../../status/StatusRegistry';
import { tagColorFor } from '../../tags/tagColor';
import { renderStatusMarker } from '../../ui/StatusMarker';
import { renderTaskText } from '../../ui/renderTaskText';
import {
  minutesToPixels,
  minutesToTimeString,
  packOverlaps,
  snapMinutes,
  timeStringToMinutes,
  type TimedBlockInput,
} from './layout';

export interface TimedBlockCallbacks {
  app: App;
  component: Component;
  onTaskClick: (task: Task) => void;
  onTimeChange: (task: Task, newStartMinutes: number) => void;
  onDurationChange: (task: Task, newDurationMinutes: number) => void;
  onToggle: (task: Task) => void;
  statusRegistry: StatusRegistry;
}

const DEFAULT_DURATION_MINUTES = 60;
const SNAP_MINUTES = 15;

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
    // Time+duration subtitle renders first (top of the block), e.g. "10:00 (1h)".
    block.createDiv({
      cls: 'tc-tg-block-subtitle',
      text: `${minutesToTimeString(p.startMinutes)} (${formatDurationFromMinutes(p.durationMinutes)})`,
    });
    // Status marker + title share one flex row so the checkbox and title render on the
    // same line instead of stacking (the title div is block-level, which previously
    // forced a line break after the inline marker span).
    const head = block.createDiv({ cls: 'tc-tg-block-head' });
    // Status marker first: lets a user mark the block done without opening the modal.
    // Its own click handler stops propagation; its contextmenu handler does NOT, so a
    // right-click on the marker still bubbles to the block's contextmenu below (opens modal).
    renderStatusMarker(head, {
      task: p.task,
      registry: callbacks.statusRegistry,
      onLeftClick: () => callbacks.onToggle(p.task),
      onContextMenu: () => {},
    });
    const titleEl = head.createDiv({ cls: 'tc-tg-block-title' });
    renderTaskText(titleEl, p.task.markdownText, {
      app: callbacks.app,
      sourcePath: p.task.filePath,
      component: callbacks.component,
    });
    const handle = block.createDiv({ cls: 'tc-tg-resize-handle' });

    block.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if ((e.target as HTMLElement).closest('.tc-tg-resize-handle')) return;
      callbacks.onTaskClick(p.task);
    });

    attachDrag(block, handle, p.startMinutes, p.durationMinutes, callbacks, p.task);
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
      const next = Math.max(0, startMinutes + deltaMinutes);
      block.style.top = `${minutesToPixels(next)}px`;
    } else {
      const next = Math.max(SNAP_MINUTES, startDuration + deltaMinutes);
      block.style.height = `${minutesToPixels(next)}px`;
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!mode) return;
    const rawDelta = ((e.clientY - startY) / minutesToPixels(60)) * 60;
    const deltaMinutes = snapMinutes(rawDelta, SNAP_MINUTES);
    if (mode === 'move') {
      callbacks.onTimeChange(task, Math.max(0, startMinutes + deltaMinutes));
    } else {
      callbacks.onDurationChange(task, Math.max(SNAP_MINUTES, startDuration + deltaMinutes));
    }
    mode = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
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
    if ((e.target as HTMLElement).closest('.tc-status-marker, a')) return;
    mode = (e.target as HTMLElement).closest('.tc-tg-resize-handle') ? 'resize' : 'move';
    startY = e.clientY;
    startMinutes = initialStart;
    startDuration = initialDuration;
    e.stopPropagation();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  block.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointerdown', onPointerDown);
}
