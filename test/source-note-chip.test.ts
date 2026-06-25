import { describe, expect, it } from 'vitest';
import type { Task } from '../src/parser/types';
import { renderSourceNoteChip, shouldShowSourceNote } from '../src/ui/sourceNoteChip';
import { freshContainer, task } from './helpers';

describe('shouldShowSourceNote', () => {
  it("'never' always returns false", () => {
    const t = task({ filePath: 'Projects/alpha.md' });
    expect(shouldShowSourceNote(t, 'never', '')).toBe(false);
    expect(shouldShowSourceNote(t, 'never', 'Projects/alpha.md')).toBe(false);
  });

  it("'always' always returns true", () => {
    const t = task({ filePath: 'periodic/daily/2026-06-25.md', dailyNoteDate: '2026-06-25' });
    expect(shouldShowSourceNote(t, 'always', '')).toBe(true);
  });

  it("'non-default' hides for daily note (dailyNoteDate set)", () => {
    const t = task({ filePath: 'periodic/daily/2026-06-25.md', dailyNoteDate: '2026-06-25' });
    expect(shouldShowSourceNote(t, 'non-default', '')).toBe(false);
  });

  it("'non-default' hides when filePath matches customFilePath", () => {
    const t = task({ filePath: 'Inbox/tasks.md', dailyNoteDate: undefined });
    expect(shouldShowSourceNote(t, 'non-default', 'Inbox/tasks.md')).toBe(false);
  });

  it("'non-default' does NOT hide when customFilePath is empty (prevents false positive)", () => {
    const t = task({ filePath: 'Inbox/tasks.md', dailyNoteDate: undefined });
    expect(shouldShowSourceNote(t, 'non-default', '')).toBe(true);
  });

  it("'non-default' shows for regular project note", () => {
    const t = task({ filePath: 'Projects/alpha.md', dailyNoteDate: undefined });
    expect(shouldShowSourceNote(t, 'non-default', '')).toBe(true);
  });
});

describe('renderSourceNoteChip', () => {
  it('appends .tc-task-source-note to container', () => {
    const container = freshContainer();
    const t = task({ filePath: 'Projects/alpha.md' } as Partial<Task>);
    renderSourceNoteChip(container, t);
    expect(container.querySelector('.tc-task-source-note')).not.toBeNull();
  });

  it('chip contains .tc-task-source-note-icon with 📄', () => {
    const container = freshContainer();
    renderSourceNoteChip(container, task({ filePath: 'Projects/alpha.md' } as Partial<Task>));
    const icon = container.querySelector('.tc-task-source-note-icon');
    expect(icon?.textContent).toBe('📄');
  });

  it('chip text contains filename without path or extension', () => {
    const container = freshContainer();
    renderSourceNoteChip(container, task({ filePath: 'a/b/deep-note.md' } as Partial<Task>));
    const chip = container.querySelector('.tc-task-source-note');
    expect(chip?.textContent).toContain('deep-note');
    expect(chip?.textContent).not.toContain('/');
    expect(chip?.textContent).not.toContain('.md');
  });

  it('chip text has space before note name', () => {
    const container = freshContainer();
    renderSourceNoteChip(container, task({ filePath: 'Note.md' } as Partial<Task>));
    const chip = container.querySelector('.tc-task-source-note');
    expect(chip?.textContent).toBe('📄 Note');
  });
});
