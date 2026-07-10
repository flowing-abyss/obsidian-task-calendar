import type { Task } from '../../parser/types';
import type { TagGroup } from '../../settings/types';
import { tagColorFor } from '../../tags/tagColor';
import {
  minutesToPixels,
  packOverlaps,
  snapMinutes,
  timeStringToMinutes,
  type TimedBlockInput,
} from './layout';

export interface TimedBlockCallbacks {
  onTaskClick: (task: Task) => void;
  onTimeChange: (task: Task, newStartMinutes: number) => void;
  onDurationChange: (task: Task, newDurationMinutes: number) => void;
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
    // Priority-colored left border (color = priority convention) + tag-colored fill.
    if (p.task.priority !== 'D') block.setAttribute('data-priority', p.task.priority);
    const tagColor = tagColorFor(p.task.rawText, tagGroups);
    if (tagColor) block.setCssProps({ '--tc-tag-color': tagColor });
    block.createDiv({ cls: 'tc-tg-block-title', text: p.task.text });
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
