import { Notice, Platform, type App, type Component } from 'obsidian';
import type { LinkToken } from '../parser/links';
import type { Task } from '../parser/types';
import type { StatusRegistry } from '../status/StatusRegistry';
import { attachLongPress } from './MobileTouch';
import { renderTaskText } from './renderTaskText';
import { renderStatusMarker } from './StatusMarker';

type TaskCardMode = 'default' | 'timeblock';

export interface TaskCardOptions {
  mode?: TaskCardMode;
  app: App;
  component: Component;
  onOpenNote: (task: Task) => void;
  onToggle?: (task: Task) => void;
  onMove?: (task: Task, newDate: string, newTime: string) => void;
  onEditLink?: (occurrenceIndex: number, token: LinkToken) => void;
  statusRegistry?: StatusRegistry;
  onContextMenu?: (ev: MouseEvent, task: Task) => void;
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
  options: TaskCardOptions,
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
  const cls = task.noteIcon ? taskClass : taskClass + ' noNoteIcon';

  // Root div
  const div = activeDocument.createElement('div');
  div.className = `task ${cls}`;
  div.setAttribute('style', style);
  div.setAttribute('data-task-text', task.text);
  div.setAttribute('title', task.text);
  if (task.due) div.setAttribute('data-due', task.due);

  // Inner wrapper
  const inner = activeDocument.createElement('div');
  inner.className = 'inner';

  // Status marker (replaces the native checkbox; also carries priority + right-click menu)
  if (mode === 'default' && options.statusRegistry) {
    renderStatusMarker(inner, {
      task,
      registry: options.statusRegistry,
      onLeftClick: () => onToggle?.(task),
      onContextMenu: (e) => options.onContextMenu?.(e, task),
    });
  }

  // Content wrapper (was an <a>; nested <a> is invalid so this is a div now)
  const content = activeDocument.createElement('div');
  content.className = 'inner-link';

  const iconEl = activeDocument.createElement('div');
  iconEl.className = 'icon';
  iconEl.textContent = taskIcon;

  const descEl = activeDocument.createElement('div');
  descEl.className = 'description';
  descEl.dataset['relative'] = relative;
  renderTaskText(descEl, task.markdownText, {
    app: options.app,
    sourcePath: task.filePath,
    component: options.component,
    onEditLink: options.onEditLink,
  });

  content.appendChild(iconEl);
  content.appendChild(descEl);
  // Clicking anywhere on the card (except a link) opens the source note.
  content.addEventListener('click', () => options.onOpenNote(task));
  inner.appendChild(content);
  div.appendChild(inner);

  // Mobile long-press
  if (Platform.isMobile) {
    attachLongPress(div, (text) => {
      new Notice(text);
    });
  }

  return div;
}
