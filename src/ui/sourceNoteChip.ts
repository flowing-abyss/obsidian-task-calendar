import { setIcon } from 'obsidian';
import type { Task } from '../parser/types';

export function shouldShowSourceNote(
  task: Task,
  sourceNoteDisplay: 'never' | 'always' | 'non-default',
  customFilePath: string,
): boolean {
  if (sourceNoteDisplay === 'never') return false;
  if (sourceNoteDisplay === 'always') return true;
  const isDefault =
    task.dailyNoteDate !== undefined || (customFilePath !== '' && task.filePath === customFilePath);
  return !isDefault;
}

export function renderSourceNoteChip(container: HTMLElement, task: Task): void {
  const noteName = task.filePath.split('/').pop()?.replace(/\.md$/, '') ?? '';
  const chip = container.createEl('span', { cls: 'tc-task-source-note' });
  const iconEl = chip.createEl('span', { cls: 'tc-task-source-note-icon' });
  setIcon(iconEl, 'file-text');
  chip.appendText(' ' + noteName);
}
