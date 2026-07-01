/**
 * Regression tests for TaskMutationService – covers all 8 required scenarios from the spec:
 * 1. Task modified after lines inserted above it.
 * 2. Two identical tasks in one file – mutation must be a no-op.
 * 3. Nested tasks and subtasks.
 * 4. File changed between read and write (rawText stale).
 * 5. LF and CRLF line endings.
 * 6. Tasks with tags, due, scheduled, time, recurrence.
 * 7. Task moved to another part of the same file.
 * 8. Ambiguous task (identical rawTexts) – file must not change.
 */
// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { App as ObsidianApp, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskLocator } from '../src/mutation/TaskLocator';
import { TaskMutationService } from '../src/mutation/TaskMutationService';
import { createAppWithFiles } from './helpers';

// Install real moment so ✅ date logic works
beforeEach(() => {
  (window as unknown as { moment: unknown }).moment = moment;
});
afterEach(() => {
  (window as unknown as { moment?: unknown }).moment = undefined;
});

async function readFile(app: ObsidianApp, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`${path} not a TFile`);
  return app.vault.cachedRead(f);
}

function svc(app: ObsidianApp): TaskMutationService {
  return new TaskMutationService(app);
}

// ── 1. Lines inserted above the task ──────────────────────────────────────────

describe('Regression 1 – lines inserted above the task', () => {
  it('finds and updates the task even when lines were inserted above it', async () => {
    // Task is originally at line 0; we insert 2 lines above → task is now at line 2.
    const original = '- [ ] Buy milk\n- [ ] other';
    const shifted = 'inserted 1\ninserted 2\n- [ ] Buy milk\n- [ ] other';
    const app = await createAppWithFiles({ 'f.md': original });

    // Build locator from the original position
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 0 };

    // Simulate the file being modified externally (overwrite with shifted content)
    const file = app.vault.getAbstractFileByPath('f.md') as TFile;
    await app.vault.modify(file, shifted);

    // Now apply the mutation — service must find the task at its new position
    const result = await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = lines[taskLine]!.replace('- [ ]', '- [x]');
    });

    expect(result.type).toBe('ok');
    const content = await readFile(app, 'f.md');
    expect(content).toContain('- [x] Buy milk');
    expect(content).toContain('inserted 1');
  });
});

// ── 2 & 8. Two identical tasks in one file ─────────────────────────────────────

describe('Regression 2 & 8 – identical tasks (ambiguous)', () => {
  it('does not modify the file when two identical task lines exist (stale hint)', async () => {
    const content = '- [ ] Buy milk\n- [ ] other\n- [ ] Buy milk';
    const app = await createAppWithFiles({ 'f.md': content });

    // Force a stale hint (line=99) so the fast path fails and the full scan triggers.
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 99 };

    const result = await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = '- [x] Buy milk';
    });

    expect(result.type).toBe('ambiguous');
    const after = await readFile(app, 'f.md');
    expect(after).toBe(content); // file unchanged
  });

  it('ambiguous result carries the candidate line numbers', async () => {
    const content = '- [ ] Task\n- [ ] Task';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] Task', line: 99 };

    const result = await svc(app).applyToLines(locator, () => {});
    expect(result.type).toBe('ambiguous');
    if (result.type === 'ambiguous') {
      expect(result.candidates).toEqual([0, 1]);
    }
  });
});

// ── 3. Nested tasks / subtasks ─────────────────────────────────────────────────

describe('Regression 3 – nested tasks and subtasks', () => {
  it('updates a parent task by rawText even when it has subtasks below', async () => {
    const content = '- [ ] parent\n    - [ ] sub1\n    - [ ] sub2\n- [ ] other';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] parent', line: 0 };

    const result = await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = '- [x] parent';
    });

    expect(result.type).toBe('ok');
    const after = await readFile(app, 'f.md');
    expect(after.split('\n')[0]).toBe('- [x] parent');
    expect(after).toContain('    - [ ] sub1');
  });

  it('updates a subtask by its own rawText (indented)', async () => {
    const content = '- [ ] parent\n    - [ ] sub1\n    - [ ] sub2';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '    - [ ] sub1', line: 1 };

    await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = '    - [x] sub1';
    });

    const after = await readFile(app, 'f.md');
    expect(after).toContain('    - [x] sub1');
    expect(after).toContain('    - [ ] sub2');
  });

  it('inserts a new subtask after the parent (splice)', async () => {
    const content = '- [ ] parent\n- [ ] other';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] parent', line: 0 };

    await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines.splice(taskLine + 1, 0, '    - [ ] new sub');
    });

    const after = await readFile(app, 'f.md');
    const parts = after.split('\n');
    expect(parts[0]).toBe('- [ ] parent');
    expect(parts[1]).toBe('    - [ ] new sub');
    expect(parts[2]).toBe('- [ ] other');
  });
});

// ── 4. File changed between read and write ─────────────────────────────────────

describe('Regression 4 – file changed externally between read and write', () => {
  it('returns not-found and leaves file unchanged when task content was altered', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] Buy milk' });
    // Build locator for the original text
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 0 };

    // Simulate external edit: the line now reads differently
    const file = app.vault.getAbstractFileByPath('f.md') as TFile;
    await app.vault.modify(file, '- [ ] Completely different content');

    const result = await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = '- [x] Buy milk';
    });

    expect(result.type).toBe('not-found');
    const after = await readFile(app, 'f.md');
    expect(after).toBe('- [ ] Completely different content');
  });
});

// ── 5. LF and CRLF line endings ──────────────────────────────────────────────

describe('Regression 5 – LF and CRLF files', () => {
  it('finds and updates task in a LF file', async () => {
    const content = '- [ ] Task A\n- [ ] Buy milk\n- [ ] Task C';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 1 };

    await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = '- [x] Buy milk';
    });

    const after = await readFile(app, 'f.md');
    expect(after).toContain('- [x] Buy milk');
  });

  it('finds and updates task in a CRLF file', async () => {
    // vault.process preserves CRLF when given CRLF input
    const crlfContent = '- [ ] Task A\r\n- [ ] Buy milk\r\n- [ ] Task C';
    const app = await createAppWithFiles({ 'f.md': crlfContent });

    // rawText from a split('\n') on CRLF content preserves trailing \r
    const rawText = '- [ ] Buy milk\r';
    const locator: TaskLocator = { filePath: 'f.md', rawText, line: 1 };

    await svc(app).applyToLines(locator, (lines, taskLine) => {
      // Replace preserving \r suffix
      lines[taskLine] = '- [x] Buy milk\r';
    });

    const after = await readFile(app, 'f.md');
    expect(after).toContain('- [x] Buy milk');
  });
});

// ── 6. Tasks with rich metadata ──────────────────────────────────────────────

describe('Regression 6 – tasks with tags, due, scheduled, time, recurrence', () => {
  it('finds task that has tags in rawText', async () => {
    const raw = '- [ ] Deploy #ops #urgent 📅 2026-06-30';
    const app = await createAppWithFiles({ 'f.md': `${raw}\n- [ ] other` });
    const locator: TaskLocator = { filePath: 'f.md', rawText: raw, line: 0 };

    await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = lines[taskLine]!.replace('- [ ]', '- [x]');
    });

    const after = await readFile(app, 'f.md');
    expect(after.split('\n')[0]).toBe('- [x] Deploy #ops #urgent 📅 2026-06-30');
  });

  it('finds task with due and scheduled dates after line shift', async () => {
    const raw = '- [ ] Report 📅 2026-07-15 ⏳ 2026-07-10';
    const app = await createAppWithFiles({ 'f.md': raw });
    const file = app.vault.getAbstractFileByPath('f.md') as TFile;
    // Insert a line above → task shifts to line 1
    await app.vault.modify(file, `inserted\n${raw}`);
    const locator: TaskLocator = { filePath: 'f.md', rawText: raw, line: 0 };

    const result = await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = lines[taskLine]!.replace('📅 2026-07-15', '📅 2026-08-01');
    });

    expect(result.type).toBe('ok');
    const after = await readFile(app, 'f.md');
    expect(after).toContain('📅 2026-08-01');
  });

  it('finds task with ⏰ time marker', async () => {
    const raw = '- [ ] Standup ⏰ 09:00';
    const app = await createAppWithFiles({ 'f.md': raw });
    const locator: TaskLocator = { filePath: 'f.md', rawText: raw, line: 0 };

    await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = lines[taskLine]!.replace('09:00', '10:00');
    });

    const after = await readFile(app, 'f.md');
    expect(after).toContain('10:00');
  });

  it('finds task with recurrence marker', async () => {
    const raw = '- [ ] Water plants 🔁 every week 📅 2026-06-30';
    const app = await createAppWithFiles({ 'f.md': raw });
    const locator: TaskLocator = { filePath: 'f.md', rawText: raw, line: 0 };

    await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = lines[taskLine]!.replace('every week', 'every day');
    });

    const after = await readFile(app, 'f.md');
    expect(after).toContain('every day');
  });
});

// ── 7. Task moved to another part of the same file ────────────────────────────

describe('Regression 7 – task moved within the same file', () => {
  it('finds and updates task that was moved from top to bottom of file', async () => {
    const original = '- [ ] Buy milk\n- [ ] other A\n- [ ] other B';
    const moved = '- [ ] other A\n- [ ] other B\n- [ ] Buy milk';
    const app = await createAppWithFiles({ 'f.md': original });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 0 };

    // Simulate the move
    const file = app.vault.getAbstractFileByPath('f.md') as TFile;
    await app.vault.modify(file, moved);

    const result = await svc(app).applyToLines(locator, (lines, taskLine) => {
      lines[taskLine] = '- [x] Buy milk';
    });

    expect(result.type).toBe('ok');
    const after = await readFile(app, 'f.md');
    // Task was at line 2 after the move; it should now be checked
    expect(after.split('\n')[2]).toBe('- [x] Buy milk');
  });
});

// ── File not found ─────────────────────────────────────────────────────────────

describe('TaskMutationService – file not found', () => {
  it('returns file-not-found and does not throw when file path is invalid', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] task' });
    const locator: TaskLocator = { filePath: 'nonexistent.md', rawText: '- [ ] task', line: 0 };
    const result = await svc(app).applyToLines(locator, () => {});
    expect(result.type).toBe('file-not-found');
  });
});

// ── toggleCompletion helper ────────────────────────────────────────────────────

describe('TaskMutationService.toggleCompletion', () => {
  it('marks open task as done and appends completion date', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] task' });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] task', line: 0 };
    await svc(app).toggleCompletion(locator, '2026-06-26');
    const after = await readFile(app, 'f.md');
    expect(after).toBe('- [x] task ✅ 2026-06-26');
  });

  it('marks done task as open and removes completion date', async () => {
    const raw = '- [x] task ✅ 2026-06-25';
    const app = await createAppWithFiles({ 'f.md': raw });
    const locator: TaskLocator = { filePath: 'f.md', rawText: raw, line: 0 };
    await svc(app).toggleCompletion(locator, '2026-06-26');
    const after = await readFile(app, 'f.md');
    expect(after).toBe('- [ ] task');
  });
});

// ── CRLF toggleCompletion regression ──────────────────────────────────────────

describe('Regression – CRLF file toggleCompletion preserves \\r', () => {
  it('toggled line in CRLF file retains trailing \\r so rawText fingerprint stays valid', async () => {
    const crlf = '- [ ] Buy milk\r\n- [ ] other\r\n';
    const app = await createAppWithFiles({ 'f.md': crlf });
    // rawText as produced by split('\n') on a CRLF file
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] Buy milk\r', line: 0 };
    const result = await svc(app).toggleCompletion(locator, '2026-06-26');
    expect(result.type).toBe('ok');
    const after = await readFile(app, 'f.md');
    // The toggled line must still end with \r so the file stays CRLF-consistent
    const lines = after.split('\n');
    expect(lines[0]).toMatch(/\r$/);
    expect(lines[0]).toContain('✅ 2026-06-26');
    // Second toggle: rawText is now the completed line with \r
    const completedRaw = lines[0]!;
    const locator2: TaskLocator = { filePath: 'f.md', rawText: completedRaw, line: 0 };
    const result2 = await svc(app).toggleCompletion(locator2, '2026-06-26');
    // Must succeed — rawText fingerprint was preserved
    expect(result2.type).toBe('ok');
    const after2 = await readFile(app, 'f.md');
    expect(after2.split('\n')[0]).toBe('- [ ] Buy milk\r');
  });
});

// ── deleteTaskBlock clamped to file length ─────────────────────────────────────

describe('Regression – deleteTaskBlock with stale rangeEndHint beyond file', () => {
  it('does not delete past the file end when rangeEndHint exceeds line count', async () => {
    const content = '- [ ] parent\n  - [ ] sub\n- [ ] next task';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] parent', line: 0 };
    // rangeEndHint=999 is way past the 3-line file
    const result = await svc(app).deleteTaskBlock(locator, 999);
    expect(result.type).toBe('ok');
    const after = await readFile(app, 'f.md');
    // Only parent + sub should be deleted; next task must survive
    expect(after).toContain('- [ ] next task');
    expect(after).not.toContain('- [ ] parent');
  });

  it('adjusts rangeEndHint by line drift before clamping', async () => {
    const original = '- [ ] task\n  - [ ] sub';
    const shifted = 'inserted\n- [ ] task\n  - [ ] sub\n- [ ] after';
    const app = await createAppWithFiles({ 'f.md': original });
    const file = app.vault.getAbstractFileByPath('f.md') as TFile;
    await app.vault.modify(file, shifted);
    // Locator from original position (line 0), rangeEndHint=1 (original sub at line 1)
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] task', line: 0 };
    const result = await svc(app).deleteTaskBlock(locator, 1);
    expect(result.type).toBe('ok');
    const after = await readFile(app, 'f.md');
    expect(after).toContain('inserted');
    expect(after).toContain('- [ ] after');
    expect(after).not.toContain('- [ ] task');
    expect(after).not.toContain('- [ ] sub');
  });
});

// ── blockquote / callout write-path integrity ─────────────────────────────────

describe('Blockquote tasks – toggle & delete preserve formatting', () => {
  it('toggling a blockquote parent leaves its sub-items untouched', async () => {
    const content = '> - [ ] parent\n> \t- [ ] child\n> - [ ] sibling';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '> - [ ] parent', line: 0 };
    await svc(app).toggleCompletion(locator, '2026-07-01');
    const after = await readFile(app, 'f.md');
    const parts = after.split('\n');
    expect(parts[0]).toBe('> - [x] parent ✅ 2026-07-01');
    expect(parts[1]).toBe('> \t- [ ] child');
    expect(parts[2]).toBe('> - [ ] sibling');
  });

  it('deleting a blockquote parent removes its blockquote sub-items too', async () => {
    const content = '> - [ ] parent\n> \t- [ ] child\n> \t- [ ] child2\n> - [ ] sibling';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '> - [ ] parent', line: 0 };
    const result = await svc(app).deleteTaskBlock(locator, 2);
    expect(result.type).toBe('ok');
    const after = await readFile(app, 'f.md');
    expect(after).toBe('> - [ ] sibling');
    expect(after).not.toContain('child');
  });

  it('deleting one task in a flat blockquote list keeps its siblings intact', async () => {
    const content = '> - [ ] A\n> - [ ] B\n> - [ ] C';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '> - [ ] B', line: 1 };
    await svc(app).deleteTaskBlock(locator, 1);
    const after = await readFile(app, 'f.md');
    expect(after).toBe('> - [ ] A\n> - [ ] C');
  });

  it('does not delete a following plain-list block when deleting a blockquote task', async () => {
    const content = '> - [ ] quoted\n- [ ] plain next\n  - [ ] plain sub';
    const app = await createAppWithFiles({ 'f.md': content });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '> - [ ] quoted', line: 0 };
    await svc(app).deleteTaskBlock(locator, 0);
    const after = await readFile(app, 'f.md');
    expect(after).toBe('- [ ] plain next\n  - [ ] plain sub');
  });
});

// ── insertLineAfter drift compensation ────────────────────────────────────────

describe('Regression – insertLineAfter compensates for line drift', () => {
  it('inserts at the correct position after lines were added above the task', async () => {
    const original = '- [ ] task\n- [ ] other';
    const shifted = 'line A\nline B\n- [ ] task\n- [ ] other';
    const app = await createAppWithFiles({ 'f.md': original });
    const file = app.vault.getAbstractFileByPath('f.md') as TFile;
    await app.vault.modify(file, shifted);
    // Locator: task was at line 0; insertAfterLine was also 0 (the task itself)
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] task', line: 0 };
    await svc(app).insertLineAfter(locator, '  - [ ] subtask', 0);
    const after = await readFile(app, 'f.md');
    const parts = after.split('\n');
    // task is now at line 2; subtask should be at line 3
    expect(parts[2]).toBe('- [ ] task');
    expect(parts[3]).toBe('  - [ ] subtask');
    expect(parts[4]).toBe('- [ ] other');
  });
});
