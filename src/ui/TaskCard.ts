import { Notice, Platform } from 'obsidian';
import type { Task } from '../parser/types';
import { attachLongPress } from './MobileTouch';

export type TaskCardMode = 'default' | 'timeblock';

export interface TaskCardOptions {
  mode?: TaskCardMode;
  onToggle?: (task: Task) => void;
  onMove?: (task: Task, newDate: string, newTime: string) => void;
}

const TASK_ICONS: Record<string, string> = {
  done: '✅',
  due: '📅',
  scheduled: '⏳',
  recurrence: '🔁',
  overdue: '⚠️',
  process: '⏺️',
  cancelled: '🚫',
  start: '🛫',
  dailyNote: '📄',
};

function transColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function createTaskCard(
  task: Task,
  taskClass: string,
  options: TaskCardOptions = {},
): HTMLElement {
  const { mode = 'default', onToggle } = options;
  const lighter = 25;
  const darker = -40;

  // Compute color style
  let style: string;
  if (task.noteColor && task.noteTextColor) {
    style = `--task-background:${task.noteColor}33;--task-color:${task.noteColor};--dark-task-text-color:${task.noteTextColor};--light-task-text-color:${task.noteTextColor}`;
  } else if (task.noteColor) {
    style = `--task-background:${task.noteColor}33;--task-color:${task.noteColor};--dark-task-text-color:${transColor(task.noteColor, darker)};--light-task-text-color:${transColor(task.noteColor, lighter)}`;
  } else if (task.noteTextColor) {
    style = `--task-background:#7D7D7D33;--task-color:#7D7D7D;--dark-task-text-color:${transColor(task.noteTextColor, darker)};--light-task-text-color:${transColor(task.noteTextColor, lighter)}`;
  } else {
    style =
      '--task-background:#7D7D7D33;--task-color:#7D7D7D;--dark-task-text-color:#4d4d4d;--light-task-text-color:#a8a8a8';
  }

  const taskIcon = TASK_ICONS[taskClass] ?? '';
  const relative = task.due ? window.moment(task.due).fromNow() : '';
  const noteFilename = task.filePath.replace(/^.*\//, '').replace(/\.[^.]*$/, '');
  const noteDisplay = task.noteIcon
    ? task.noteIcon + ' ' + noteFilename
    : taskIcon + ' ' + noteFilename;
  const cls = task.noteIcon ? taskClass : taskClass + ' noNoteIcon';
  const filePathNoExt = task.filePath.replace(/\.md$/, '');

  // Root div
  const div = document.createElement('div');
  div.className = `task ${cls}`;
  div.setAttribute('style', style);
  div.setAttribute('data-task-text', task.text);
  div.setAttribute('title', task.text);
  if (task.due) div.setAttribute('data-due', task.due);

  // Inner wrapper
  const inner = document.createElement('div');
  inner.className = 'inner';

  // Checkbox
  if (mode === 'default') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'calendar-task-checkbox';
    checkbox.checked = task.status === 'done';
    if (onToggle) {
      checkbox.addEventListener('change', () => {
        onToggle(task);
      });
    }
    inner.appendChild(checkbox);
  }

  // Link wrapping note + description
  const link = document.createElement('a');
  link.className = 'internal-link';
  link.setAttribute('href', filePathNoExt);

  // Note label: placed directly on .task (before .inner) so <a> has only
  // inline children, keeping .inner a single text line in modern Chromium
  // (display:-webkit-box no longer establishes a block for line-clamp).
  const noteEl = document.createElement('div');
  noteEl.className = 'note';
  noteEl.textContent = noteDisplay;
  div.appendChild(noteEl);

  const iconEl = document.createElement('div');
  iconEl.className = 'icon';
  iconEl.textContent = taskIcon;

  const descEl = document.createElement('div');
  descEl.className = 'description';
  descEl.dataset['relative'] = relative;
  descEl.textContent = task.text;

  link.appendChild(iconEl);
  link.appendChild(descEl);
  inner.appendChild(link);
  div.appendChild(inner);

  // Mobile long-press
  if (Platform.isMobile) {
    attachLongPress(div, (text) => {
      new Notice(text);
    });
  }

  return div;
}
