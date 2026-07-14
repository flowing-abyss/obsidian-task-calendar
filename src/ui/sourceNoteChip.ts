import { setIcon } from 'obsidian';
import type { TaskSnapshot } from '../tasks';

export function shouldShowSourceNote(
  task: TaskSnapshot,
  sourceNoteDisplay: 'never' | 'always' | 'non-default',
  customFilePath: string,
): boolean {
  if (sourceNoteDisplay === 'never') return false;
  if (sourceNoteDisplay === 'always') return true;
  const isDefault =
    task.presentation.dailyNoteDate !== undefined ||
    (customFilePath !== '' && task.source.filePath === customFilePath);
  return !isDefault;
}

export function renderSourceNoteChip(
  container: HTMLElement,
  task: TaskSnapshot,
  onClick?: (filePath: string) => void,
): void {
  const noteName = task.source.filePath.split('/').pop()?.replace(/\.md$/, '') ?? '';
  const chip = container.createEl('span', {
    cls: `tc-task-source-note${onClick ? ' tc-task-source-note--clickable' : ''}`,
  });
  const iconEl = chip.createEl('span', { cls: 'tc-task-source-note-icon' });
  setIcon(iconEl, 'file-text');
  chip.createEl('span', { cls: 'tc-task-source-note-name', text: noteName });
  if (onClick) {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(task.source.filePath);
    });
  }
}
