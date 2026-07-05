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

/** Bracket-access helper to call private methods (preserves `this` binding). */
function call<T>(panel: RightPanel, method: string, ...args: unknown[]): T {
  const fn = (panel as unknown as Record<string, (...a: unknown[]) => T>)[method]!;
  return fn.call(panel, ...args);
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
    expect(el.querySelector('.tc-right-title-view')).toBeNull();
    state.set('taskStack', [task({ text: 'Hello' })]);
    const view = el.querySelector('.tc-right-title-view');
    expect(view).not.toBeNull();
  });

  it('destroy removes the taskStack listener (no re-render after destroy)', async () => {
    const { panel, state, el } = await makePanel();
    panel.destroy();
    state.set('taskStack', [task({ text: 'After destroy' })]);
    expect(el.querySelector('.tc-right-title-view')).toBeNull();
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
    // Crumb text renders via MarkdownRenderer (mocked as a noop in tests), so we
    // assert on the crumb item element's presence rather than its textContent.
    expect(breadcrumb?.querySelector('.tc-breadcrumb-item')).not.toBeNull();
  });

  it('title view renders idle; clicking it enters edit mode with markdownText', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'My task' })]);
    const view = el.querySelector<HTMLElement>('.tc-right-title-view')!;
    expect(view).not.toBeNull();
    expect(el.querySelector('.tc-right-title-edit')).toBeNull();

    click(view);
    const ta = el.querySelector<HTMLTextAreaElement>('.tc-right-title-edit');
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe('My task');
  });

  it('editing the title and blurring writes back via updateTaskTitle', async () => {
    const fileContent = '- [ ] My task\n';
    const { state, el, app } = await makePanel({ 'f.md': fileContent });
    state.set('taskStack', [task({ text: 'My task', rawText: '- [ ] My task' })]);
    const view = el.querySelector<HTMLElement>('.tc-right-title-view')!;
    click(view);
    const ta = el.querySelector<HTMLTextAreaElement>('.tc-right-title-edit')!;
    ta.value = 'Updated task';
    ta.dispatchEvent(new Event('blur', { bubbles: true }));
    await flushMicrotasks();

    const written = await readMd(app, 'f.md');
    expect(written).toContain('Updated task');
    expect(el.querySelector('.tc-right-title-edit')).toBeNull();
    expect(el.querySelector('.tc-right-title-view')).not.toBeNull();
  });

  it('date chip renders (non-empty) when task.due is present', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [
      task({ text: 'Dated', due: '2026-06-25', rawText: '- [ ] Dated 📅 2026-06-25' }),
    ]);
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
    state.set('taskStack', [task({ text: 'Tagged', rawText: '- [ ] Tagged #work #home/kitchen' })]);
    const tagChips = el.querySelectorAll('.tc-chip-tag');
    expect(tagChips).toHaveLength(2);
    expect(tagChips[0]?.textContent).toContain('#work');
    expect(tagChips[1]?.textContent).toContain('#home/kitchen');
  });
});

describe('RightPanel.renderSubTask', () => {
  it('subtask row renders status marker + label text', async () => {
    const { state, el } = await makePanel();
    const sub: SubTask = {
      filePath: 'f.md',
      line: 1,
      rawText: '  - [ ] sub one',
      text: 'sub one',
      markdownText: 'sub one',
      status: 'open',
      statusSymbol: ' ',
      priority: 'D',
    };
    state.set('taskStack', [task({ text: 'Parent', subtasks: [sub] })]);
    const row = el.querySelector('.tc-subtask-row');
    expect(row).not.toBeNull();
    const marker = row?.querySelector<HTMLElement>('.tc-status-marker');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('data-status-type')).toBe('todo');
    // Label text renders via MarkdownRenderer (mocked as a noop in tests), so we
    // assert on the label element's presence rather than its textContent.
    expect(row?.querySelector('.tc-subtask-label')).not.toBeNull();
  });

  it('clicking the status marker → toggleSubTask writes [x] to file', async () => {
    const { state, el, app } = await makePanel({
      'f.md': '- [ ] parent\n  - [ ] sub one',
    });
    const sub: SubTask = {
      filePath: 'f.md',
      line: 1,
      rawText: '  - [ ] sub one',
      text: 'sub one',
      markdownText: 'sub one',
      status: 'open',
      statusSymbol: ' ',
      priority: 'D',
    };
    state.set('taskStack', [task({ filePath: 'f.md', line: 0, text: 'parent', subtasks: [sub] })]);
    const marker = el.querySelector<HTMLElement>('.tc-status-marker')!;
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
    // Comment text renders through MarkdownRenderer (a no-op mock in tests), so assert the
    // element exists rather than its async-populated textContent.
    expect(row?.querySelector('.tc-comment-text')).not.toBeNull();
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
    state.set('taskStack', [
      task({ text: 'D', due: '2026-06-25', rawText: '- [ ] D 📅 2026-06-25' }),
    ]);
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

  it('priority popover options use the shared menu option structure', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'P', priority: 'F' })]);
    const chip = el.querySelector<HTMLElement>('.tc-priority-chip')!;
    click(chip);

    const active = el.querySelector<HTMLElement>('.tc-priority-option.is-active');

    const children = Array.from(active?.children ?? []).map((el) => el.className);

    expect(children).toEqual([
      'tc-priority-option-check',
      'tc-priority-option-flag',
      'tc-priority-option-label',
    ]);
    expect(active?.querySelector('.tc-priority-option-flag')).not.toBeNull();
    expect(active?.querySelector('.tc-priority-option-label')?.textContent).toBe('Lowest');
    expect(active?.querySelector('.tc-priority-option-check')).not.toBeNull();
  });

  it('priority popover is shifted left when it would overflow the right panel', async () => {
    const { panel, el } = await makePanel();
    const anchor = document.createElement('button');
    const popover = document.createElement('div');

    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(anchor, 'offsetLeft', { configurable: true, value: 173 });
    Object.defineProperty(anchor, 'offsetTop', { configurable: true, value: 57 });
    Object.defineProperty(anchor, 'offsetHeight', { configurable: true, value: 24 });
    Object.defineProperty(popover, 'offsetWidth', { configurable: true, value: 180 });
    popover.style.setProperty('--tc-popover-anchor-gap', '0.25rem');
    popover.style.setProperty('--tc-popover-edge-gap', '1rem');

    call<void>(panel, 'positionAnchoredPopover', popover, anchor);

    expect(popover.style.getPropertyValue('--tc-pop-top')).toBe('85px');
    expect(popover.style.getPropertyValue('--tc-pop-left')).toBe('124px');
  });

  it('outside click dismisses the priority popover', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'P', priority: 'B' })]);
    const chip = el.querySelector<HTMLElement>('.tc-priority-chip')!;
    click(chip);
    expect(el.querySelector('.tc-priority-popover')).not.toBeNull();
    // The outside-click listener is registered via setTimeout(0); wait for it.
    await tick(5);
    // Click on an unrelated element (the title view) — bubbles to el → once:click removes pop.
    const title = el.querySelector<HTMLElement>('.tc-right-title-view')!;
    click(title);
    expect(el.querySelector('.tc-priority-popover')).toBeNull();
  });
});
