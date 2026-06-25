import { TFile, type App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/AppState';
import { RightPanel } from '../src/panels/RightPanel';
import type { SubTask, TaskComment } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import {
  createAppWithFiles,
  flushMicrotasks,
  freshContainer,
  task,
  useRealMoment,
} from './helpers';

useRealMoment();

/** Read a markdown file's current content via the vault. */
async function readMd(app: App, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`${path} is not a TFile`);
  return app.vault.cachedRead(f);
}

/** Resolve after a real setTimeout so popover `setTimeout(0)` listeners attach. */
function tick(ms = 5): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Dispatch a click event on an element. */
function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Dispatch a change event on an input. */
function change(el: HTMLInputElement): void {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Wire up a real RightPanel + AppState with a vault file. `fileContent` is
 * seeded at `f.md` so vault-write tests can assert on the resulting content.
 */
async function makePanel(
  files: Record<string, string> = {},
): Promise<{ panel: RightPanel; state: AppState; app: App; el: HTMLElement }> {
  const app = await createAppWithFiles(files);
  const state = new AppState();
  const panel = new RightPanel(state, app, DEFAULT_SETTINGS);
  const el = freshContainer();
  panel.mount(el);
  return { panel, state, app, el };
}

describe('RightPanel render lifecycle', () => {
  it('mount subscribes to taskStack → re-renders when stack changes', async () => {
    const { state, el } = await makePanel();
    expect(el.querySelector('.tc-right-title')).toBeNull();
    state.set('taskStack', [task({ text: 'Hello' })]);
    const input = el.querySelector<HTMLInputElement>('.tc-right-title');
    expect(input).not.toBeNull();
    expect(input!.value).toBe('Hello');
  });

  it('destroy removes the taskStack listener (no re-render after destroy)', async () => {
    const { panel, state, el } = await makePanel();
    panel.destroy();
    state.set('taskStack', [task({ text: 'After destroy' })]);
    expect(el.querySelector('.tc-right-title')).toBeNull();
    expect(el.children).toHaveLength(0);
  });

  it('empty taskStack renders the empty-state message', async () => {
    const { el } = await makePanel();
    expect(el.querySelector('.tc-right-empty')).not.toBeNull();
    expect(el.querySelector('.tc-right-empty-title')?.textContent).toBe('No task selected');
  });
});

describe('RightPanel.renderTask', () => {
  it('breadcrumb renders only when stack.length > 1', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'Parent' }), task({ text: 'Child' })]);
    const breadcrumb = el.querySelector('.tc-breadcrumb');
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb?.textContent).toContain('Parent');
  });

  it('title input value === task.text', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'My task' })]);
    expect(el.querySelector<HTMLInputElement>('.tc-right-title')?.value).toBe('My task');
  });

  it('date chip renders (non-empty) when task.due is present', async () => {
    const { state, el } = await makePanel();
    state.set(
      'taskStack',
      [task({ text: 'Dated', due: '2026-06-25', rawText: '- [ ] Dated 📅 2026-06-25' })],
    );
    const chips = el.querySelectorAll('.tc-chips-row .tc-chip');
    const dateChip = Array.from(chips).find((c) => c.textContent?.startsWith('📅'));
    expect(dateChip).toBeDefined();
    expect(dateChip?.classList.contains('tc-chip-empty')).toBe(false);
  });

  it('priority chip renders (non-empty) when task.priority !== "D"', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'P', priority: 'A' })]);
    const chip = el.querySelector('.tc-priority-chip');
    expect(chip).not.toBeNull();
    expect(chip?.classList.contains('tc-chip-empty')).toBe(false);
    expect(chip?.getAttribute('data-priority')).toBe('A');
  });

  it('tag chips render for each #tag in rawText', async () => {
    const { state, el } = await makePanel();
    state.set(
      'taskStack',
      [task({ text: 'Tagged', rawText: '- [ ] Tagged #work #home/kitchen' })],
    );
    const tagChips = el.querySelectorAll('.tc-chip-tag');
    expect(tagChips).toHaveLength(2);
    expect(tagChips[0]?.textContent).toContain('#work');
    expect(tagChips[1]?.textContent).toContain('#home/kitchen');
  });
});

describe('RightPanel.renderSubTask', () => {
  it('subtask row renders checkbox + label text', async () => {
    const { state, el } = await makePanel();
    const sub: SubTask = {
      filePath: 'f.md',
      line: 1,
      rawText: '  - [ ] sub one',
      text: 'sub one',
      status: 'open',
      priority: 'D',
    };
    state.set('taskStack', [task({ text: 'Parent', subtasks: [sub] })]);
    const row = el.querySelector('.tc-subtask-row');
    expect(row).not.toBeNull();
    const cb = row?.querySelector<HTMLInputElement>('.tc-task-checkbox');
    expect(cb).not.toBeNull();
    expect(cb?.checked).toBe(false);
    expect(row?.querySelector('.tc-subtask-label')?.textContent).toBe('sub one');
  });

  it('checkbox change → toggleSubTask writes [x] to file', async () => {
    const { state, el, app } = await makePanel({
      'f.md': '- [ ] parent\n  - [ ] sub one',
    });
    const sub: SubTask = {
      filePath: 'f.md',
      line: 1,
      rawText: '  - [ ] sub one',
      text: 'sub one',
      status: 'open',
      priority: 'D',
    };
    state.set(
      'taskStack',
      [task({ filePath: 'f.md', line: 0, text: 'parent', subtasks: [sub] })],
    );
    const cb = el.querySelector<HTMLInputElement>('.tc-task-checkbox')!;
    change(cb);
    await flushMicrotasks(20);
    const content = await readMd(app, 'f.md');
    expect(content).toContain('  - [x] sub one');
  });
});

describe('RightPanel.renderComment', () => {
  it('comment row renders date span + text', async () => {
    const { state, el } = await makePanel();
    const comment: TaskComment = { line: 1, date: '2026-06-20', text: 'hello world' };
    state.set('taskStack', [task({ text: 'T', comments: [comment] })]);
    const row = el.querySelector('.tc-comment-row');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.tc-comment-date')).not.toBeNull();
    expect(row?.querySelector('.tc-comment-text')?.textContent).toBe('hello world');
  });

  it('click on comment text → edit-mode textarea appears', async () => {
    const { state, el } = await makePanel();
    const comment: TaskComment = { line: 1, date: '2026-06-20', text: 'editable' };
    state.set('taskStack', [task({ text: 'T', comments: [comment] })]);
    const textEl = el.querySelector<HTMLElement>('.tc-comment-text')!;
    click(textEl);
    expect(el.querySelector('.tc-comment-edit-input')).not.toBeNull();
    expect(el.querySelector('.tc-comment-text')).toBeNull();
  });
});

describe('RightPanel popovers', () => {
  it('date chip click → date popover appears', async () => {
    const { state, el } = await makePanel();
    state.set(
      'taskStack',
      [task({ text: 'D', due: '2026-06-25', rawText: '- [ ] D 📅 2026-06-25' })],
    );
    const chips = el.querySelectorAll('.tc-chips-row .tc-chip');
    const dateChip = Array.from(chips).find((c) => c.textContent?.startsWith('📅')) as HTMLElement;
    expect(dateChip).toBeDefined();
    click(dateChip);
    expect(el.querySelector('.tc-date-popover')).not.toBeNull();
    expect(el.querySelector('.tc-date-input')).not.toBeNull();
  });

  it('priority chip click → priority popover appears with options', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'P', priority: 'B' })]);
    const chip = el.querySelector<HTMLElement>('.tc-priority-chip')!;
    click(chip);
    const pop = el.querySelector('.tc-priority-popover');
    expect(pop).not.toBeNull();
    expect(pop?.querySelectorAll('.tc-priority-option').length).toBe(6);
  });

  it('outside click dismisses the priority popover', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'P', priority: 'B' })]);
    const chip = el.querySelector<HTMLElement>('.tc-priority-chip')!;
    click(chip);
    expect(el.querySelector('.tc-priority-popover')).not.toBeNull();
    // The outside-click listener is registered via setTimeout(0); wait for it.
    await tick(5);
    // Click on an unrelated element (the title input) — bubbles to el → once:click removes pop.
    const title = el.querySelector<HTMLInputElement>('.tc-right-title')!;
    click(title);
    expect(el.querySelector('.tc-priority-popover')).toBeNull();
  });
});