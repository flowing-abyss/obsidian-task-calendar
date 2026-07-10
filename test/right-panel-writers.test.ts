// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { TFile, type App } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { RightPanel } from '../src/panels/RightPanel';
import type { SubTask, Task, TaskComment } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { CalendarSettings, TagGroup } from '../src/settings/types';
import { openInFile } from '../src/ui/taskNavigation';
import { createAppWithFiles, freshContainer, seedTaskCache, task, useRealMoment } from './helpers';

useRealMoment();

/**
 * Read a markdown file's current content via the vault. Throws if the path is
 * not a TFile so tests fail loudly when a write didn't happen.
 */
async function readMd(app: App, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`${path} is not a TFile`);
  return app.vault.cachedRead(f);
}

/** Bracket-access helper to call private methods (preserves `this` binding). */
function call<T>(panel: RightPanel, method: string, ...args: unknown[]): T {
  const fn = (panel as unknown as Record<string, (...a: unknown[]) => T>)[method]!;
  return fn.call(panel, ...args);
}

/**
 * Wire up a real RightPanel + real AppState with seeded files and task cache.
 * RightPanel does not use TaskStore for writers, only `app` + `state` + `settings`.
 */
async function makePanel(
  files: Record<string, string>,
  settings: CalendarSettings = DEFAULT_SETTINGS,
  seeds: Array<{ path: string; items: Array<{ task: string; parent: number; line: number }> }> = [],
): Promise<{ panel: RightPanel; state: AppState; app: App }> {
  const app = await createAppWithFiles(files);
  for (const s of seeds) seedTaskCache(app, s.path, s.items);
  const state = new AppState();
  const panel = new RightPanel(state, app, settings);
  return { panel, state, app };
}

describe('RightPanel.getTagColor', () => {
  it('prefix mode: exact match returns group.color', async () => {
    const group: TagGroup = {
      id: 'g1',
      name: 'Work',
      mode: 'prefix',
      prefix: 'work',
      color: '#ff0000',
    };
    const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
    const { panel } = await makePanel({ 't.md': '- [ ] x' }, settings);
    expect(call<string | undefined>(panel, 'getTagColor', '#work')).toBe('#ff0000');
  });

  it('prefix mode: slash subtag matches (e.g. #work/deep)', async () => {
    const group: TagGroup = {
      id: 'g1',
      name: 'Work',
      mode: 'prefix',
      prefix: 'work',
      color: '#ff0000',
    };
    const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
    const { panel } = await makePanel({ 't.md': '- [ ] x' }, settings);
    expect(call<string | undefined>(panel, 'getTagColor', '#work/deep')).toBe('#ff0000');
  });

  it('manual mode: matches tag with or without leading #', async () => {
    const group: TagGroup = {
      id: 'g1',
      name: 'Manual',
      mode: 'manual',
      tags: ['#urgent', 'low'],
      color: '#00ff00',
    };
    const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
    const { panel } = await makePanel({ 't.md': '- [ ] x' }, settings);
    expect(call<string | undefined>(panel, 'getTagColor', '#urgent')).toBe('#00ff00');
    expect(call<string | undefined>(panel, 'getTagColor', '#low')).toBe('#00ff00');
  });

  it('no matching group → undefined', async () => {
    const group: TagGroup = {
      id: 'g1',
      name: 'Work',
      mode: 'prefix',
      prefix: 'work',
      color: '#ff0000',
    };
    const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
    const { panel } = await makePanel({ 't.md': '- [ ] x' }, settings);
    expect(call<string | undefined>(panel, 'getTagColor', '#personal')).toBeUndefined();
  });

  it('no settings → undefined', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] x' });
    const state = new AppState();
    const panel = new RightPanel(state, app, undefined);
    expect(call<string | undefined>(panel, 'getTagColor', '#anything')).toBeUndefined();
  });
});

describe('RightPanel.formatDate', () => {
  // formatDate reads window.moment(); use fake timers + real moment module so
  // window.moment() reflects the frozen system time. No vault access needed.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T12:00:00Z'));
    (window as unknown as { moment: unknown }).moment = moment;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makePanelNoVault(): RightPanel {
    const state = new AppState();
    const app = { vault: { getAbstractFileByPath: () => null } } as unknown as App;
    return new RightPanel(state, app, DEFAULT_SETTINGS);
  }

  it('today → "Today"', () => {
    const panel = makePanelNoVault();
    expect(call<string>(panel, 'formatDate', '2026-06-25')).toBe('Today');
  });

  it('tomorrow → "Tomorrow"', () => {
    const panel = makePanelNoVault();
    expect(call<string>(panel, 'formatDate', '2026-06-26')).toBe('Tomorrow');
  });

  it('other date → "D MMM" format', () => {
    const panel = makePanelNoVault();
    expect(call<string>(panel, 'formatDate', '2026-07-25')).toBe('25 Jul');
  });
});

describe('RightPanel.updateTaskTitle', () => {
  it('replaces title preserving prefix and metadata suffix', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] old title 📅 2026-06-20' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'old title',
      rawText: '- [ ] old title 📅 2026-06-20',
      due: '2026-06-20',
    });
    await call<Promise<void>>(panel, 'updateTaskTitle', t, 'new title');
    const content = await readMd(app, 't.md');
    expect(content).toContain('new title');
    expect(content).toContain('📅 2026-06-20');
    expect(content).not.toContain('old title');
  });

  it('preserves tags in suffix', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] old #work' });
    const t = task({ filePath: 't.md', line: 0, text: 'old', rawText: '- [ ] old #work' });
    await call<Promise<void>>(panel, 'updateTaskTitle', t, 'renamed');
    const content = await readMd(app, 't.md');
    expect(content).toContain('renamed');
    expect(content).toContain('#work');
  });

  it('no-op if line has no checkbox prefix', async () => {
    const { panel, app } = await makePanel({ 't.md': 'just plain text' });
    const t = task({ filePath: 't.md', line: 0, text: 'plain', rawText: 'just plain text' });
    await call<Promise<void>>(panel, 'updateTaskTitle', t, 'renamed');
    const content = await readMd(app, 't.md');
    expect(content).toBe('just plain text');
  });

  it('file not found → no-op (no throw)', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(
      call<Promise<void>>(panel, 'updateTaskTitle', t, 'renamed'),
    ).resolves.toBeUndefined();
  });
});

describe('RightPanel.updateDescription', () => {
  it('inserts a new description line when none exists', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task\n- [ ] other' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    await call<Promise<void>>(panel, 'updateDescription', t, 'a description');
    const content = await readMd(app, 't.md');
    expect(content).toContain('- > a description');
    expect(content).toContain('- [ ] task');
    expect(content).toContain('- [ ] other');
  });

  it('removes existing description lines before inserting new (single line desc)', async () => {
    // When subtaskRange is provided, lines between rangeStart and rangeEnd are filtered
    // for `- > ` lines. Use range 0..1 to cover the desc line at index 1.
    const content = '- [ ] task\n  - > old desc\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task',
      subtaskRange: { from: 0, to: 1 },
    });
    await call<Promise<void>>(panel, 'updateDescription', t, 'new desc');
    const after = await readMd(app, 't.md');
    expect(after).toContain('- > new desc');
    expect(after).not.toContain('old desc');
  });

  it('empty description removes existing desc lines only', async () => {
    const content = '- [ ] task\n  - > old desc\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task',
      subtaskRange: { from: 0, to: 1 },
    });
    await call<Promise<void>>(panel, 'updateDescription', t, '');
    const after = await readMd(app, 't.md');
    expect(after).not.toContain('- >');
    expect(after).toContain('- [ ] task');
    expect(after).toContain('- [ ] other');
  });

  // CURRENT BEHAVIOR: when subtaskRange is absent, rangeStart = task.line+1 and
  // rangeEnd = task.line (clamped empty range), so existing description lines below
  // the task are NOT filtered out — they remain alongside the newly inserted desc.
  it('without subtaskRange: existing desc lines are NOT filtered (CURRENT BEHAVIOR)', async () => {
    const content = '- [ ] task\n  - > old desc\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    await call<Promise<void>>(panel, 'updateDescription', t, 'new desc');
    const after = await readMd(app, 't.md');
    // old desc remains because range is empty; new desc is inserted at task.line+1
    expect(after).toContain('old desc');
    expect(after).toContain('new desc');
  });

  it('multi-line description inserts multiple - > lines', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task\n- [ ] other' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    await call<Promise<void>>(panel, 'updateDescription', t, 'line one\nline two');
    const after = await readMd(app, 't.md');
    expect(after).toContain('- > line one');
    expect(after).toContain('- > line two');
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(
      call<Promise<void>>(panel, 'updateDescription', t, 'desc'),
    ).resolves.toBeUndefined();
  });
});

describe('RightPanel.addSubTask', () => {
  it('without subtaskRange: inserts a new subtask line right after task line', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] parent\n- [ ] other' });
    const t = task({ filePath: 't.md', line: 0, text: 'parent', rawText: '- [ ] parent' });
    await call<Promise<void>>(panel, 'addSubTask', t, 'first sub');
    const after = await readMd(app, 't.md');
    const lines = after.split('\n');
    expect(lines[1]).toContain('- [ ] first sub');
    expect(lines[0]).toBe('- [ ] parent');
    expect(lines[2]).toBe('- [ ] other');
  });

  it('with subtaskRange: inserts after range.to', async () => {
    const content = '- [ ] parent\n    - [ ] existing sub\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'parent',
      rawText: '- [ ] parent',
      subtaskRange: { from: 0, to: 1 },
    });
    await call<Promise<void>>(panel, 'addSubTask', t, 'new sub');
    const after = await readMd(app, 't.md');
    const lines = after.split('\n');
    // new sub should be at index 2 (after existing sub at index 1)
    expect(lines[2]).toContain('- [ ] new sub');
    expect(lines[3]).toBe('- [ ] other');
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(call<Promise<void>>(panel, 'addSubTask', t, 'sub')).resolves.toBeUndefined();
  });
});

describe('RightPanel.toggleSubTask', () => {
  it('open → done: replaces "- [ ]" with "- [x]" (case-sensitive)', async () => {
    const { panel, app } = await makePanel({ 't.md': '  - [ ] sub' });
    const sub: SubTask = {
      filePath: 't.md',
      line: 0,
      rawText: '  - [ ] sub',
      text: 'sub',
      markdownText: 'sub',
      status: 'open',
      statusSymbol: ' ',
      priority: 'D',
    };
    await call<Promise<void>>(panel, 'toggleSubTask', sub);
    const after = await readMd(app, 't.md');
    expect(after).toContain('- [x]');
    expect(after).not.toContain('- [ ]');
  });

  // FU-28 fix: toggling is now registry-driven (via statusSymbol -> typeForSymbol),
  // not the stale/caller-supplied `status` field, so an uppercase "[X]" (done, via
  // the X->x alias) correctly toggles to the registry's default todo symbol.
  it('registry-driven: "- [X]" (done via X->x alias) toggles to open, ignoring stale status field', async () => {
    const { panel, app } = await makePanel({ 't.md': '  - [X] sub' });
    const sub: SubTask = {
      filePath: 't.md',
      line: 0,
      rawText: '  - [X] sub',
      text: 'sub',
      markdownText: 'sub',
      status: 'open', // caller claims open, but statusSymbol 'X' resolves to done
      statusSymbol: 'X',
      priority: 'D',
    };
    await call<Promise<void>>(panel, 'toggleSubTask', sub);
    const after = await readMd(app, 't.md');
    expect(after).toBe('  - [ ] sub');
  });

  it('done → open: replaces "- [x]" with "- [ ]" (case-insensitive)', async () => {
    const { panel, app } = await makePanel({ 't.md': '  - [x] sub' });
    const sub: SubTask = {
      filePath: 't.md',
      line: 0,
      rawText: '  - [x] sub',
      text: 'sub',
      markdownText: 'sub',
      status: 'done',
      statusSymbol: 'x',
      priority: 'D',
    };
    await call<Promise<void>>(panel, 'toggleSubTask', sub);
    const after = await readMd(app, 't.md');
    expect(after).toContain('- [ ]');
    expect(after).not.toContain('- [x]');
  });

  it('done → open: case-insensitive matches uppercase "- [X]"', async () => {
    const { panel, app } = await makePanel({ 't.md': '  - [X] sub' });
    const sub: SubTask = {
      filePath: 't.md',
      line: 0,
      rawText: '  - [X] sub',
      text: 'sub',
      markdownText: 'sub',
      status: 'done',
      statusSymbol: 'X',
      priority: 'D',
    };
    await call<Promise<void>>(panel, 'toggleSubTask', sub);
    const after = await readMd(app, 't.md');
    expect(after).toContain('- [ ]');
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '  - [ ] sub' });
    const sub: SubTask = {
      filePath: 'missing.md',
      line: 0,
      rawText: '  - [ ] sub',
      text: 'sub',
      markdownText: 'sub',
      status: 'open',
      statusSymbol: ' ',
      priority: 'D',
    };
    await expect(call<Promise<void>>(panel, 'toggleSubTask', sub)).resolves.toBeUndefined();
  });
});

describe('RightPanel.addComment', () => {
  // addComment uses window.moment().format('YYYY-MM-DD') for the date stamp.
  // We freeze time AFTER createAppWithFiles (which uses setTimeout internally)
  // so the vault setup completes with real timers, then moment reports 2026-06-25.
  // Restore real timers in afterEach so subsequent describes aren't affected.
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Install fake timers frozen at 2026-06-25 for the addComment date stamp. */
  function freezeToday(): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T12:00:00Z'));
    (window as unknown as { moment: unknown }).moment = moment;
  }

  it('appends a comment line "- <today>: <text>" after the task line (no subtaskRange)', async () => {
    const { panel, state, app } = await makePanel({ 't.md': '- [ ] task\n- [ ] other' });
    freezeToday();
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    state.set('taskStack', [t]);
    const commentList = freshContainer();
    const inputEl = freshContainer().createEl('textarea');
    await call<Promise<void>>(panel, 'addComment', t, 'hello', commentList, inputEl);
    const after = await readMd(app, 't.md');
    const lines = after.split('\n');
    // CURRENT BEHAVIOR: optimistic DOM update creates a row in commentList before writing
    expect(commentList.querySelectorAll('.tc-comment-row')).toHaveLength(1);
    expect(inputEl.value).toBe('');
    // Line 1 should be the comment (inserted at task.line + 1)
    expect(lines[1]).toContain('2026-06-25: hello');
    expect(lines[0]).toBe('- [ ] task');
    expect(lines[2]).toBe('- [ ] other');
  });

  it('with subtaskRange: inserts after range.to', async () => {
    const content = '- [ ] task\n    - [ ] sub\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    freezeToday();
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task',
      subtaskRange: { from: 0, to: 1 },
    });
    const commentList = freshContainer();
    const inputEl = freshContainer().createEl('textarea');
    await call<Promise<void>>(panel, 'addComment', t, 'c', commentList, inputEl);
    const after = await readMd(app, 't.md');
    const lines = after.split('\n');
    expect(lines[2]).toContain('2026-06-25: c');
    expect(lines[3]).toBe('- [ ] other');
  });

  // CURRENT BEHAVIOR (follow-up: FU-27): addComment performs an optimistic DOM update
  // (appends a row + clears input) BEFORE awaiting vault.process. If the vault write
  // throws, the DOM is left in an inconsistent state with no rollback.
  it('optimistic DOM update happens before vault write (CURRENT BEHAVIOR, FU-27)', async () => {
    const { panel, state } = await makePanel({ 't.md': '- [ ] task' });
    freezeToday();
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    state.set('taskStack', [t]);
    const commentList = freshContainer();
    const inputEl = freshContainer().createEl('textarea');
    inputEl.value = 'pre-existing';
    // Use a task whose filePath doesn't exist → vault write returns early (no throw),
    // but the DOM has already been mutated. This documents the no-rollback pattern.
    const missing = { ...t, filePath: 'missing.md' };
    await call<Promise<void>>(panel, 'addComment', missing, 'ghost', commentList, inputEl);
    expect(commentList.querySelectorAll('.tc-comment-row')).toHaveLength(1);
    expect(inputEl.value).toBe('');
  });

  it('file not found → no-op on vault, DOM still updated optimistically', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] task' });
    freezeToday();
    const t = task({ filePath: 'missing.md', line: 0, text: 'task', rawText: '- [ ] task' });
    const commentList = freshContainer();
    const inputEl = freshContainer().createEl('textarea');
    await expect(
      call<Promise<void>>(panel, 'addComment', t, 'x', commentList, inputEl),
    ).resolves.toBeUndefined();
  });
});

describe('RightPanel.updateComment', () => {
  it('preserves date prefix when present', async () => {
    const content = '- [ ] task\n  - 2026-06-20: old text\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    const comment: TaskComment = { line: 1, date: '2026-06-20', text: 'old text' };
    await call<Promise<void>>(panel, 'updateComment', t, comment, 'new text');
    const after = await readMd(app, 't.md');
    const lines = after.split('\n');
    expect(lines[1]).toBe('  - 2026-06-20: new text');
  });

  it('without date prefix: uses bare "- " prefix', async () => {
    const content = '- [ ] task\n  - plain comment\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    const comment: TaskComment = { line: 1, text: 'plain comment' };
    await call<Promise<void>>(panel, 'updateComment', t, comment, 'edited');
    const after = await readMd(app, 't.md');
    const lines = after.split('\n');
    expect(lines[1]).toBe('  - edited');
  });

  // CURRENT BEHAVIOR (follow-up: FU-29): for a malformed comment line (no "- " prefix),
  // updateComment falls back to barePrefix = /^(\s*- )/.exec(line)?.[1] ?? '' which yields
  // '' when there's no "- " — so the leading whitespace is discarded and the line is
  // replaced with just the new text (no indent, no dash).
  it('malformed line (no "- " prefix) discards leading whitespace (CURRENT BEHAVIOR, FU-29)', async () => {
    const content = '- [ ] task\n    not-a-comment\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    const comment: TaskComment = { line: 1, text: 'not-a-comment' };
    await call<Promise<void>>(panel, 'updateComment', t, comment, 'replacement');
    const after = await readMd(app, 't.md');
    const lines = after.split('\n');
    // FU-29: barePrefix is '' so the line becomes just "replacement" — no indent, no dash
    expect(lines[1]).toBe('replacement');
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    const comment: TaskComment = { line: 1, text: 'x' };
    await expect(
      call<Promise<void>>(panel, 'updateComment', t, comment, 'y'),
    ).resolves.toBeUndefined();
  });
});

describe('RightPanel.deleteComment', () => {
  it('valid index removes the comment line', async () => {
    const content = '- [ ] task\n  - 2026-06-20: c1\n  - 2026-06-21: c2\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    const comment: TaskComment = { line: 1, date: '2026-06-20', text: 'c1' };
    await call<Promise<void>>(panel, 'deleteComment', t, comment);
    const after = await readMd(app, 't.md');
    const lines = after.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('- [ ] task');
    expect(lines[1]).toContain('c2');
    expect(lines[2]).toBe('- [ ] other');
  });

  it('out-of-range line: splice at non-existent index → no-op on content (CURRENT BEHAVIOR)', async () => {
    const content = '- [ ] task\n- [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    // line 99 doesn't exist; splice(99,1) on a 2-element array is a no-op
    const comment: TaskComment = { line: 99, text: 'ghost' };
    await call<Promise<void>>(panel, 'deleteComment', t, comment);
    const after = await readMd(app, 't.md');
    expect(after).toBe(content);
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    const comment: TaskComment = { line: 0, text: 'x' };
    await expect(call<Promise<void>>(panel, 'deleteComment', t, comment)).resolves.toBeUndefined();
  });
});

describe('RightPanel.updateDue', () => {
  it('with due: replaces existing 📅 date', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task 📅 2026-06-20' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task 📅 2026-06-20',
      due: '2026-06-20',
    });
    await call<Promise<void>>(panel, 'updateDue', t, '2026-06-28');
    const after = await readMd(app, 't.md');
    expect(after).toContain('📅 2026-06-28');
    expect(after).not.toContain('2026-06-20');
  });

  it('without due: appends " 📅 <date>" to the line', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    await call<Promise<void>>(panel, 'updateDue', t, '2026-06-28');
    const after = await readMd(app, 't.md');
    expect(after).toContain('📅 2026-06-28');
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(call<Promise<void>>(panel, 'updateDue', t, '2026-06-28')).resolves.toBeUndefined();
  });
});

describe('RightPanel scheduled/start/duration writers', () => {
  it('updateScheduled adds ⏳ without touching an existing 📅', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] t 📅 2026-07-01' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 't',
      rawText: '- [ ] t 📅 2026-07-01',
      due: '2026-07-01',
    });
    await call<Promise<void>>(panel, 'updateScheduled', t, '2026-07-02');
    const content = await readMd(app, 't.md');
    expect(content).toContain('⏳ 2026-07-02');
    expect(content).toContain('📅 2026-07-01');
  });

  it('clearScheduled strips only ⏳, leaves 📅 intact', async () => {
    const { panel, app } = await makePanel({
      't.md': '- [ ] t ⏳ 2026-07-02 📅 2026-07-01',
    });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 't',
      rawText: '- [ ] t ⏳ 2026-07-02 📅 2026-07-01',
      due: '2026-07-01',
      scheduled: '2026-07-02',
    });
    await call<Promise<void>>(panel, 'clearScheduled', t);
    const content = await readMd(app, 't.md');
    expect(content).not.toContain('⏳');
    expect(content).toContain('📅 2026-07-01');
  });

  it('updateStart adds 🛫 alongside 📅', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] t 📅 2026-07-05' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 't',
      rawText: '- [ ] t 📅 2026-07-05',
      due: '2026-07-05',
    });
    await call<Promise<void>>(panel, 'updateStart', t, '2026-07-01');
    const content = await readMd(app, 't.md');
    expect(content).toContain('🛫 2026-07-01');
    expect(content).toContain('📅 2026-07-05');
  });

  it('clearStart strips only 🛫', async () => {
    const { panel, app } = await makePanel({
      't.md': '- [ ] t 🛫 2026-07-01 📅 2026-07-05',
    });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 't',
      rawText: '- [ ] t 🛫 2026-07-01 📅 2026-07-05',
      due: '2026-07-05',
      start: '2026-07-01',
    });
    await call<Promise<void>>(panel, 'clearStart', t);
    const content = await readMd(app, 't.md');
    expect(content).not.toContain('🛫');
    expect(content).toContain('📅 2026-07-05');
  });

  it('updateDuration writes ⏱️ in shortest form', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] t ⏰ 15:00' });
    const t: Task = task({
      filePath: 't.md',
      line: 0,
      text: 't',
      rawText: '- [ ] t ⏰ 15:00',
      time: '15:00',
    });
    await call<Promise<void>>(panel, 'updateDuration', t, 90);
    const content = await readMd(app, 't.md');
    expect(content).toContain('⏱️ 1h30m');
  });

  it('clearDuration strips ⏱️', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] t ⏰ 15:00 ⏱️ 1h30m' });
    const t: Task = task({
      filePath: 't.md',
      line: 0,
      text: 't',
      rawText: '- [ ] t ⏰ 15:00 ⏱️ 1h30m',
      time: '15:00',
      duration: 90,
    });
    await call<Promise<void>>(panel, 'clearDuration', t);
    const content = await readMd(app, 't.md');
    expect(content).not.toContain('⏱️');
    expect(content).toContain('⏰ 15:00');
  });

  it('file not found → no-op for updateScheduled/clearScheduled/updateStart/clearStart', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(
      call<Promise<void>>(panel, 'updateScheduled', t, '2026-07-02'),
    ).resolves.toBeUndefined();
    await expect(call<Promise<void>>(panel, 'clearScheduled', t)).resolves.toBeUndefined();
    await expect(
      call<Promise<void>>(panel, 'updateStart', t, '2026-07-01'),
    ).resolves.toBeUndefined();
    await expect(call<Promise<void>>(panel, 'clearStart', t)).resolves.toBeUndefined();
  });

  it('file not found → no-op for updateDuration/clearDuration', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t: Task = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(call<Promise<void>>(panel, 'updateDuration', t, 30)).resolves.toBeUndefined();
    await expect(call<Promise<void>>(panel, 'clearDuration', t)).resolves.toBeUndefined();
  });
});

describe('RightPanel.clearDate', () => {
  // CURRENT BEHAVIOR (follow-up: FU-24): clearDate strips 📅 (due), ⏳ (scheduled),
  // AND 🛫 (start) — all three date emojis — not just the due date. The regex is
  // /[📅⏳🛫]\s*\d{4}-\d{2}-\d{2}/gu. This is a known quirk: the method name suggests
  // it clears only the due date but it actually clears all dates.
  it('strips ALL date emojis: 📅, ⏳, and 🛫 (CURRENT BEHAVIOR, FU-24)', async () => {
    const content = '- [ ] task 📅 2026-06-20 ⏳ 2026-06-21 🛫 2026-06-19';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: content,
      due: '2026-06-20',
      scheduled: '2026-06-21',
      start: '2026-06-19',
    });
    await call<Promise<void>>(panel, 'clearDate', t);
    const after = await readMd(app, 't.md');
    expect(after).not.toContain('📅');
    expect(after).not.toContain('⏳');
    expect(after).not.toContain('🛫');
    expect(after).toContain('task');
  });

  it('strips only 📅 when no scheduled/start present', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task 📅 2026-06-20' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task 📅 2026-06-20',
      due: '2026-06-20',
    });
    await call<Promise<void>>(panel, 'clearDate', t);
    const after = await readMd(app, 't.md');
    expect(after).not.toContain('📅');
    expect(after).toBe('- [ ] task');
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(call<Promise<void>>(panel, 'clearDate', t)).resolves.toBeUndefined();
  });
});

describe('RightPanel.updatePriority', () => {
  it('A → appends 🔺 (highest)', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task',
      priority: 'D',
    });
    await call<Promise<void>>(panel, 'updatePriority', t, 'A');
    const after = await readMd(app, 't.md');
    expect(after).toContain('🔺');
  });

  it('B → appends ⏫', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task',
      priority: 'D',
    });
    await call<Promise<void>>(panel, 'updatePriority', t, 'B');
    const after = await readMd(app, 't.md');
    expect(after).toContain('⏫');
  });

  it('C → sets Medium priority (🔼), replacing any existing emoji', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task 🔺' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task 🔺',
      priority: 'A',
    });
    await call<Promise<void>>(panel, 'updatePriority', t, 'C');
    const after = await readMd(app, 't.md');
    // C maps to 🔼 (Medium). The old 🔺 should be stripped and 🔼 appended.
    expect(after).not.toContain('🔺');
    expect(after).toContain('🔼');
  });

  it('D → strips all priority emojis, appends nothing (Normal = no emoji)', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task 🔺' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task 🔺',
      priority: 'A',
    });
    await call<Promise<void>>(panel, 'updatePriority', t, 'D');
    const after = await readMd(app, 't.md');
    // FU-30: D is not in PRIORITY_MAP, so no emoji is appended
    expect(after).not.toContain('🔺');
    expect(after).not.toContain('⏫');
    expect(after).not.toContain('🔼');
    expect(after).not.toContain('🔽');
    expect(after).not.toContain('⏬');
    expect(after).toBe('- [ ] task');
  });

  it('E → appends 🔽', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task',
      priority: 'D',
    });
    await call<Promise<void>>(panel, 'updatePriority', t, 'E');
    const after = await readMd(app, 't.md');
    expect(after).toContain('🔽');
  });

  it('F → appends ⏬', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task',
      priority: 'D',
    });
    await call<Promise<void>>(panel, 'updatePriority', t, 'F');
    const after = await readMd(app, 't.md');
    expect(after).toContain('⏬');
  });

  it('replaces existing priority emoji with new one', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task 🔺' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task 🔺',
      priority: 'A',
    });
    await call<Promise<void>>(panel, 'updatePriority', t, 'F');
    const after = await readMd(app, 't.md');
    expect(after).not.toContain('🔺');
    expect(after).toContain('⏬');
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(call<Promise<void>>(panel, 'updatePriority', t, 'A')).resolves.toBeUndefined();
  });
});

describe('RightPanel.removeTag', () => {
  it('removes a standalone tag (with leading #)', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task #work' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task #work' });
    await call<Promise<void>>(panel, 'removeTag', t, '#work');
    const after = await readMd(app, 't.md');
    expect(after).not.toContain('#work');
    expect(after).toContain('task');
  });

  it('removes a standalone tag (without leading #)', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task #work' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task #work' });
    await call<Promise<void>>(panel, 'removeTag', t, 'work');
    const after = await readMd(app, 't.md');
    expect(after).not.toContain('#work');
  });

  it('subtag guard: does not remove #work when only #work/deep matches (and vice versa)', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task #work/deep' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task #work/deep',
    });
    // Removing "#work" should NOT remove "#work/deep" because the regex uses a
    // negative lookahead for word chars or subtag separator: (?![\w/-])
    await call<Promise<void>>(panel, 'removeTag', t, '#work');
    const after = await readMd(app, 't.md');
    expect(after).toContain('#work/deep');
  });

  it('removes #work and leaves #work/deep intact when both present', async () => {
    const content = '- [ ] task #work #work/deep';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: content });
    await call<Promise<void>>(panel, 'removeTag', t, '#work');
    const after = await readMd(app, 't.md');
    // #work (standalone) is removed; #work/deep is kept due to the (?![\w/-]) lookahead
    expect(after).not.toMatch(/#work(?!\/)/u);
    expect(after).toContain('#work/deep');
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(call<Promise<void>>(panel, 'removeTag', t, '#work')).resolves.toBeUndefined();
  });
});

describe('RightPanel.addTag', () => {
  it('without #: adds the # prefix', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    await call<Promise<void>>(panel, 'addTag', t, 'work');
    const after = await readMd(app, 't.md');
    expect(after).toContain('#work');
  });

  it('with #: keeps the # as-is', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    await call<Promise<void>>(panel, 'addTag', t, '#work');
    const after = await readMd(app, 't.md');
    expect(after).toContain('#work');
    expect(after.match(/#/gu)).toHaveLength(1);
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(call<Promise<void>>(panel, 'addTag', t, 'work')).resolves.toBeUndefined();
  });
});

describe('RightPanel.updateTime', () => {
  it('set time on a line with no existing time', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    await call<Promise<void>>(panel, 'updateTime', t, '14:30');
    const after = await readMd(app, 't.md');
    expect(after).toContain('⏰ 14:30');
  });

  it('replace existing time', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task ⏰ 09:00' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task ⏰ 09:00',
      time: '09:00',
    });
    await call<Promise<void>>(panel, 'updateTime', t, '14:30');
    const after = await readMd(app, 't.md');
    expect(after).toContain('⏰ 14:30');
    expect(after).not.toContain('09:00');
  });

  it('clear time (empty string) removes ⏰', async () => {
    const { panel, app } = await makePanel({ 't.md': '- [ ] task ⏰ 09:00' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'task',
      rawText: '- [ ] task ⏰ 09:00',
      time: '09:00',
    });
    await call<Promise<void>>(panel, 'updateTime', t, '');
    const after = await readMd(app, 't.md');
    expect(after).not.toContain('⏰');
    expect(after).not.toContain('09:00');
  });

  it('file not found → no-op', async () => {
    const { panel } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(call<Promise<void>>(panel, 'updateTime', t, '14:30')).resolves.toBeUndefined();
  });
});

describe('RightPanel.deleteTask', () => {
  it('with subtaskRange: removes the whole block (from..to inclusive)', async () => {
    const content = '- [ ] parent\n    - [ ] sub\n- [ ] other';
    const { panel, state, app } = await makePanel({ 't.md': content });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'parent',
      rawText: '- [ ] parent',
      subtaskRange: { from: 0, to: 1 },
    });
    state.set('taskStack', [t]);
    await call<Promise<void>>(panel, 'deleteTask', t);
    const after = await readMd(app, 't.md');
    expect(after).toBe('- [ ] other');
  });

  // CURRENT BEHAVIOR (follow-up: FU-26): deleteTask without subtaskRange only removes
  // the single task line (from = to = task.line). If the task has descendants (subtasks,
  // deleteTaskBlock now uses indentation scanning to find the actual block end,
  // so even without subtaskRange the entire indented block is deleted correctly.
  it('without subtaskRange: deletes the task and all indented descendants via indentation scan', async () => {
    const content = '- [ ] parent\n    - [ ] sub\n    - > desc line\n- [ ] other';
    const { panel, state, app } = await makePanel({ 't.md': content });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'parent',
      rawText: '- [ ] parent',
      // No subtaskRange — indentation scan determines block extent
    });
    state.set('taskStack', [t]);
    await call<Promise<void>>(panel, 'deleteTask', t);
    const after = await readMd(app, 't.md');
    // Parent and all indented children are removed; the next sibling survives.
    expect(after).not.toContain('- [ ] parent');
    expect(after).not.toContain('- [ ] sub');
    expect(after).not.toContain('- > desc line');
    expect(after).toContain('- [ ] other');
  });

  it('clears taskStack after deletion', async () => {
    const { panel, state, app } = await makePanel({ 't.md': '- [ ] task\n- [ ] other' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '- [ ] task' });
    state.set('taskStack', [t]);
    await call<Promise<void>>(panel, 'deleteTask', t);
    expect(state.get('taskStack')).toEqual([]);
    const after = await readMd(app, 't.md');
    expect(after).toBe('- [ ] other');
  });

  it('file not found → no-op, does not clear stack (early return before state.set)', async () => {
    const { panel, state } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    state.set('taskStack', [t]);
    await call<Promise<void>>(panel, 'deleteTask', t);
    // CURRENT BEHAVIOR: `if (!(file instanceof TFile)) return;` runs before state.set,
    // so the stack is NOT cleared when the file is missing.
    expect(state.get('taskStack')).toHaveLength(1);
  });
});

describe('openInFile (used by RightPanel)', () => {
  it('calls workspace.getLeaf("tab") + leaf.openFile(file) + editor.setCursor', async () => {
    const { app } = await makePanel({ 't.md': '- [ ] task' });
    const t = task({ filePath: 't.md', line: 3, text: 'task', rawText: '- [ ] task' });
    // Build a leaf with a view + editor so openInFile can call setCursor.
    const leaf = app.workspace.getLeaf('tab');
    const setCursor = vi.fn();
    (leaf as unknown as { view: unknown }).view = { editor: { setCursor } };
    // getLeaf('tab') creates a new leaf each call, so spy to return our pre-seeded leaf.
    const getLeafSpy = vi.spyOn(app.workspace, 'getLeaf').mockImplementation(() => leaf);
    await openInFile(app, t);
    expect(getLeafSpy).toHaveBeenCalledWith('tab');
    expect((leaf as unknown as { file?: { path: string } }).file?.path).toBe('t.md');
    expect(setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 });
    getLeafSpy.mockRestore();
  });

  it('file not found (not a TFile) → no-op, does not throw', async () => {
    const { app } = await makePanel({ 't.md': '- [ ] x' });
    const t = task({ filePath: 'missing.md', line: 0, text: 'x', rawText: '- [ ] x' });
    await expect(openInFile(app, t)).resolves.toBeUndefined();
  });
});

describe('RightPanel — blockquote write-path preserves "> " formatting', () => {
  it('updateTaskTitle preserves the blockquote prefix and metadata', async () => {
    const { panel, app } = await makePanel({ 't.md': '> - [ ] old 📅 2026-06-20' });
    const t = task({
      filePath: 't.md',
      line: 0,
      text: 'old',
      rawText: '> - [ ] old 📅 2026-06-20',
      due: '2026-06-20',
    });
    await call<Promise<void>>(panel, 'updateTaskTitle', t, 'new');
    const after = await readMd(app, 't.md');
    expect(after).toBe('> - [ ] new 📅 2026-06-20');
  });

  it('addSubTask nests a quoted child under a blockquote parent', async () => {
    const { panel, app } = await makePanel({ 't.md': '> - [ ] parent\n> - [ ] other' });
    const t = task({ filePath: 't.md', line: 0, text: 'parent', rawText: '> - [ ] parent' });
    await call<Promise<void>>(panel, 'addSubTask', t, 'child');
    const lines = (await readMd(app, 't.md')).split('\n');
    expect(lines[1]).toBe('>   - [ ] child');
    expect(lines[2]).toBe('> - [ ] other');
  });

  it('updateDescription writes a quoted description line', async () => {
    const { panel, app } = await makePanel({ 't.md': '> - [ ] task\n> - [ ] other' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '> - [ ] task' });
    await call<Promise<void>>(panel, 'updateDescription', t, 'a desc');
    const after = await readMd(app, 't.md');
    expect(after).toContain('>   - > a desc');
    expect(after).toContain('> - [ ] other');
  });

  it('addComment writes a quoted comment line under a blockquote task', async () => {
    const today = window.moment().format('YYYY-MM-DD');
    const { panel, app } = await makePanel({ 't.md': '> - [ ] task\n> - [ ] other' });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '> - [ ] task' });
    const commentList = freshContainer();
    const inputEl = freshContainer().createEl('textarea');
    await call<Promise<void>>(panel, 'addComment', t, 'note', commentList, inputEl);
    const lines = (await readMd(app, 't.md')).split('\n');
    expect(lines[1]).toBe(`>   - ${today}: note`);
  });

  it('updateComment preserves the blockquote prefix on a quoted comment', async () => {
    const content = '> - [ ] task\n>   - 2026-06-20: old\n> - [ ] other';
    const { panel, app } = await makePanel({ 't.md': content });
    const t = task({ filePath: 't.md', line: 0, text: 'task', rawText: '> - [ ] task' });
    const comment: TaskComment = { line: 1, date: '2026-06-20', text: 'old' };
    await call<Promise<void>>(panel, 'updateComment', t, comment, 'new');
    const lines = (await readMd(app, 't.md')).split('\n');
    expect(lines[1]).toBe('>   - 2026-06-20: new');
  });
});
