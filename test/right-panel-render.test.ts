import { TFile, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { RightPanel } from '../src/panels/RightPanel';
import type { SubTask, Task, TaskComment } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { toStatusRules } from '../src/settings/statusCatalogAdapter';
import type { TaskApplicationApi, TaskSnapshot } from '../src/tasks';
import { TaskApplicationService } from '../src/tasks/application/TaskApplicationService';
import { legacyTaskViews } from '../src/tasks/compat/legacyTaskView';
import { StatusCatalog } from '../src/tasks/domain/StatusCatalog';
import type { TaskRef } from '../src/tasks/domain/types';
import { TaskIndex } from '../src/tasks/infrastructure/TaskIndex';
import { TaskBlockEditor } from '../src/tasks/infrastructure/markdown/TaskBlockEditor';
import { TaskLocator } from '../src/tasks/infrastructure/markdown/TaskLocator';
import { TaskMarkdownCodec } from '../src/tasks/infrastructure/markdown/TaskMarkdownCodec';
import { ObsidianTaskRepository } from '../src/tasks/infrastructure/obsidian/ObsidianTaskRepository';
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

/** Read the textContent of the first element matching `sel` inside `el`, or '' if absent. */
function el2Text(el: HTMLElement, sel: string): string {
  return el.querySelector(sel)?.textContent ?? '';
}

/** Bracket-access helper to call private methods (preserves `this` binding). */
function call<T>(panel: RightPanel, method: string, ...args: unknown[]): T {
  const fn = (panel as unknown as Record<string, (...a: unknown[]) => T>)[method]!;
  return fn.call(panel, ...args);
}

function attachCurrentRef(panel: RightPanel, taskLike: SubTask): void {
  const roots = legacyTaskViews(
    (panel as unknown as { tasks: TaskApplicationApi }).tasks.queries.list(),
  );
  const queue: Array<Task | SubTask> = [...roots];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.filePath === taskLike.filePath && current.line === taskLike.line) {
      if ('ref' in current) Object.assign(taskLike, { ref: current.ref });
      return;
    }
    queue.push(...(current.subtasks ?? []));
  }
}

/**
 * Wire up a real RightPanel + AppState with a vault file. `fileContent` is
 * seeded at `f.md` so vault-write tests can assert on the resulting content.
 */
async function makePanel(
  files: Record<string, string> = {},
  tasks?: TaskApplicationApi,
): Promise<{ panel: RightPanel; state: AppState; app: App; el: HTMLElement }> {
  const app = await createAppWithFiles(files);
  const state = new AppState();
  const statusCatalog = new StatusCatalog(toStatusRules(DEFAULT_SETTINGS.taskStatuses));
  const index = new TaskIndex(app, {
    statusCatalog,
    dailyNoteFormat: DEFAULT_SETTINGS.desktop.dailyNoteFormat,
  });
  const defaultTasks = new TaskApplicationService(
    index,
    new ObsidianTaskRepository(app, {
      codec: new TaskMarkdownCodec(statusCatalog),
      editor: new TaskBlockEditor(),
      locator: new TaskLocator(),
      snapshotsFromContent: (path, content) => index.snapshotsFromContent(path, content),
    }),
    statusCatalog,
    { today: () => '2026-07-14' as never },
  );
  await index.initialize();
  const panel = new RightPanel(state, app, DEFAULT_SETTINGS, undefined, tasks ?? defaultTasks);
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
    const { panel, state, el, app } = await makePanel({ 'f.md': fileContent });
    const current = task({ text: 'My task', rawText: '- [ ] My task' });
    attachCurrentRef(panel, current);
    state.set('taskStack', [current]);
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

  it.each(['A', 'B', 'C', 'E', 'F'] as const)(
    'priority chip carries data-priority="%s" so it can be color-keyed anywhere it mounts',
    async (priority) => {
      const { state, el } = await makePanel();
      state.set('taskStack', [task({ text: 'P', priority })]);
      const chip = el.querySelector('.tc-priority-chip');
      expect(chip?.getAttribute('data-priority')).toBe(priority);
    },
  );

  // Round 4 Task 41: the priority chip's color rule (styles.css) reads
  // `--tc-priority-*`, which is only defined under `.tc-panel-view` (see
  // PanelView.ts). TaskModal mounts RightPanel at document.body OUTSIDE that
  // class, so without a hardcoded fallback the chip rendered colorless in the
  // task detail modal even though the correct data-priority attribute was
  // always present. Guard the fallback so this can't silently regress.
  it('priority chip color rule in styles.css falls back to a global color var (works outside .tc-panel-view)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(import.meta.dirname, '..', 'styles.css'), 'utf8');
    const rule = /\.tc-priority-chip\[data-priority='A'\]\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/var\(--tc-priority-a,\s*var\(--color-red\)\)/);
  });

  it('tag chips render for each #tag in rawText', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'Tagged', rawText: '- [ ] Tagged #work #home/kitchen' })]);
    const tagChips = el.querySelectorAll('.tc-chip-tag');
    expect(tagChips).toHaveLength(2);
    expect(tagChips[0]?.textContent).toContain('#work');
    expect(tagChips[1]?.textContent).toContain('#home/kitchen');
  });

  it('does not render a removable chip for a tag lookalike inside inline code', async () => {
    const { state, el } = await makePanel();
    const inlineOnly = Object.assign(task({ text: 'Tagged', rawText: '- [ ] Tagged `#work`' }), {
      tags: [],
    });

    state.set('taskStack', [inlineOnly]);

    expect(el.querySelectorAll('.tc-chip-tag')).toHaveLength(0);
  });

  it('renders one canonical chip for mixed inline and real occurrences', async () => {
    const { state, el } = await makePanel();
    const mixed = Object.assign(task({ text: 'Tagged', rawText: '- [ ] Tagged `#work` #work' }), {
      tags: ['#work'],
    });

    state.set('taskStack', [mixed]);

    expect(el.querySelectorAll('.tc-chip-tag')).toHaveLength(1);
    expect(el.querySelector('.tc-chip-tag')?.textContent).toContain('#work');
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
    const { panel, state, el, app } = await makePanel({
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
    attachCurrentRef(panel, sub);
    state.set('taskStack', [task({ filePath: 'f.md', line: 0, text: 'parent', subtasks: [sub] })]);
    const marker = el.querySelector<HTMLElement>('.tc-status-marker')!;
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushMicrotasks(20);
    const content = await readMd(app, 'f.md');
    expect(content).toContain('  - [x] sub one');
  });

  // Same bug class as the priority chip fix (Round 4 Task 41): the subtask row's
  // status marker (styles.css `.tc-status-marker[data-priority='X']`) also reads
  // bare `--tc-priority-*`, which is only defined under `.tc-panel-view`. Subtask
  // rows render here in RightPanel, which TaskModal mounts at document.body
  // OUTSIDE that class — so without a hardcoded fallback the marker's
  // priority-colored border/color was lost in the task detail modal. Guard the
  // fallback so this can't silently regress.
  it.each([
    ['A', 'red'],
    ['B', 'orange'],
    ['C', 'yellow'],
    ['E', 'blue'],
    ['F', 'purple'],
  ] as const)(
    "status marker priority='%s' rule in styles.css falls back to var(--color-%s) (works outside .tc-panel-view)",
    async (priority, colorName) => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const css = readFileSync(resolve(import.meta.dirname, '..', 'styles.css'), 'utf8');
      const rule =
        new RegExp(
          `\\.tc-status-marker\\[data-priority='${priority}'\\]\\s*\\{([^}]*)\\}`,
          'u',
        ).exec(css)?.[1] ?? '';
      const priorityVar = priority.toLowerCase();
      expect(rule).toMatch(
        new RegExp(
          `border-color:\\s*var\\(--tc-priority-${priorityVar},\\s*var\\(--color-${colorName}\\)\\)`,
        ),
      );
      expect(rule).toMatch(
        new RegExp(
          `color:\\s*var\\(--tc-priority-${priorityVar},\\s*var\\(--color-${colorName}\\)\\)`,
        ),
      );
    },
  );
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

  it('clears a scheduled-only task through the visible Date chip and refreshes the UI', async () => {
    const ref: TaskRef = { filePath: 'f.md', line: 0, revision: 'old' };
    const freshRef: TaskRef = { ...ref, revision: 'fresh' };
    const fresh: TaskSnapshot = {
      ref: freshRef,
      title: 'Scheduled',
      markdownTitle: 'Scheduled',
      status: 'open',
      statusSymbol: ' ',
      priority: 'D',
      planning: {},
      tags: [],
      subtasks: [],
      comments: [],
      source: { filePath: 'f.md', line: 0, originalMarkdown: '- [ ] Scheduled' },
      presentation: { linkCount: 0 },
    };
    const execute = vi.fn<TaskApplicationApi['execute']>().mockResolvedValue({
      type: 'ok',
      changed: true,
      outcome: { type: 'task', task: fresh },
    });
    const tasks: TaskApplicationApi = {
      queries: {
        list: () => [],
        forCalendarDates: () => [],
        resolve: (target) => ({ type: 'not-found', ref: target }),
        subscribe: () => () => {},
      },
      execute,
    };
    const { state, el } = await makePanel({ 'f.md': '- [ ] Scheduled ⏳ 2026-07-05\n' }, tasks);
    state.set('taskStack', [
      Object.assign(
        task({
          filePath: 'f.md',
          text: 'Scheduled',
          due: undefined,
          scheduled: '2026-07-05',
          rawText: '- [ ] Scheduled ⏳ 2026-07-05',
        }),
        { ref },
      ),
    ]);

    const dateChip = Array.from(el.querySelectorAll<HTMLElement>('.tc-chips-row .tc-chip')).find(
      (chip) => chip.textContent?.startsWith('📅'),
    );
    expect(dateChip).toBeDefined();
    click(dateChip!);
    click(el.querySelector<HTMLElement>('.tc-popover-clear-icon-btn')!);
    await flushMicrotasks();

    expect(execute).toHaveBeenCalledWith({
      type: 'patch',
      target: { type: 'task', ref },
      patch: { scheduled: { type: 'clear' } },
    });
    expect(el2Text(el, '.tc-chips-row .tc-chip')).toContain('Date');
    expect(el.querySelector('.tc-chip-scheduled')).toBeNull();
  });

  it('time chip click → popover has both a time input and a duration input', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [
      task({ text: 'T', time: '15:00', duration: 90, rawText: '- [ ] T ⏰ 15:00 ⏱️ 1h30m' }),
    ]);
    const chip = el.querySelector<HTMLElement>('.tc-chip-time')!;
    click(chip);
    expect(el.querySelector('.tc-time-popover')).not.toBeNull();
    const timeInput = el.querySelector<HTMLInputElement>('.tc-time-input')!;
    expect(timeInput.value).toBe('15:00');
    const durationInput = el.querySelector<HTMLInputElement>('.tc-duration-input')!;
    expect(durationInput).not.toBeNull();
    expect(durationInput.value).toBe('1h30m');
  });

  it('editing the duration input sends one validated duration patch', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] T ⏰ 15:00' });
    const state = new AppState();
    const ref: TaskRef = { filePath: 'f.md', line: 0, revision: 'r' };
    const execute = vi.fn<TaskApplicationApi['execute']>().mockResolvedValue({
      type: 'not-found',
      target: { type: 'task', ref },
    });
    const tasks: TaskApplicationApi = {
      queries: {
        list: () => [],
        forCalendarDates: () => [],
        resolve: (target) => ({ type: 'not-found', ref: target }),
        subscribe: () => () => {},
      },
      execute,
    };
    const panel = new RightPanel(state, app, DEFAULT_SETTINGS, undefined, tasks);
    const el = freshContainer();
    panel.mount(el);
    state.set('taskStack', [
      Object.assign(
        task({
          filePath: 'f.md',
          line: 0,
          text: 'T',
          time: '15:00',
          duration: undefined, // real parseTask output always has this key, even when unset
          rawText: '- [ ] T ⏰ 15:00',
        }),
        { ref },
      ),
    ]);
    const chip = el.querySelector<HTMLElement>('.tc-chip-time')!;
    click(chip);
    const durationInput = el.querySelector<HTMLInputElement>('.tc-duration-input')!;
    durationInput.value = '2h';
    durationInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      type: 'patch',
      target: { type: 'task', ref },
      patch: { duration: { type: 'set', value: 120 } },
    });
  });

  it('the duration input does not render for a SubTask (no duration field)', async () => {
    const { state, el } = await makePanel();
    const sub: SubTask = {
      filePath: 'f.md',
      line: 1,
      rawText: '  - [ ] sub ⏰ 09:00',
      text: 'sub',
      markdownText: 'sub',
      status: 'open',
      statusSymbol: ' ',
      priority: 'D',
      time: '09:00',
    };
    state.set('taskStack', [task({ text: 'Parent' }), sub]);
    const chip = el.querySelector<HTMLElement>('.tc-chip-time')!;
    click(chip);
    expect(el.querySelector('.tc-time-popover')).not.toBeNull();
    expect(el.querySelector('.tc-duration-input')).toBeNull();
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

describe('RightPanel Start/Plan badges (round-pill, unified with due/time/priority)', () => {
  it('unset Start and Plan render NO placeholder badges in the top chip row; a "+" control is offered instead', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'Dated', due: '2026-06-25', duration: undefined })]);
    // No placeholder pills for unset Start/Plan clutter the main row any more.
    expect(el.querySelector('.tc-chip-start')).toBeNull();
    expect(el.querySelector('.tc-chip-scheduled')).toBeNull();
    // No separate "Planning" disclosure exists any more — fully unified into the top row.
    expect(el.querySelector('.tc-planning-section')).toBeNull();
    // Compact "+"-style control, mirroring the "+ tag" button's pattern.
    const addBtn = el.querySelector<HTMLElement>('.tc-chip-add-date');
    expect(addBtn).not.toBeNull();
  });

  it('a task with scheduled set shows a value-bearing (non-empty) scheduled badge in the top row', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [
      task({ text: 'Sched', due: undefined, scheduled: '2026-07-05', duration: undefined }),
    ]);
    const chip = el.querySelector('.tc-chip-scheduled');
    expect(chip?.textContent).toContain('5 Jul');
    expect(chip?.classList.contains('tc-chip-empty')).toBe(false);
  });

  it('a task with start set shows a value-bearing (non-empty) start badge in the top row', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [
      task({ text: 'Started', due: undefined, start: '2026-07-05', duration: undefined }),
    ]);
    const chip = el.querySelector('.tc-chip-start');
    expect(chip?.textContent).toContain('5 Jul');
    expect(chip?.classList.contains('tc-chip-empty')).toBe(false);
  });

  it('the "+" control\'s menu offers both Start and Plan when neither is set', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'Dated', due: '2026-06-25', duration: undefined })]);
    const addBtn = el.querySelector<HTMLElement>('.tc-chip-add-date')!;
    click(addBtn);
    const menu = el.querySelector('.tc-add-date-menu');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Start');
    expect(menu?.textContent).toContain('Plan');
  });

  it('the "+" control\'s menu offers only the currently-unset field when the other is already set', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [
      task({ text: 'Sched', due: undefined, scheduled: '2026-07-05', duration: undefined }),
    ]);
    // Plan is set, so it renders as a normal pill and is no longer offered in the menu.
    expect(el.querySelector('.tc-chip-scheduled')).not.toBeNull();
    const addBtn = el.querySelector<HTMLElement>('.tc-chip-add-date')!;
    click(addBtn);
    const menu = el.querySelector('.tc-add-date-menu');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Start');
    expect(menu?.textContent).not.toContain('Plan');
  });

  it('the "+" control does not render once both Start and Plan are set', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [
      task({ text: 'Both', start: '2026-07-01', scheduled: '2026-07-05', duration: undefined }),
    ]);
    expect(el.querySelector('.tc-chip-add-date')).toBeNull();
  });

  it('clicking "Start" in the "+" menu opens the same date popover style used for the due-date chip', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'Dated', due: '2026-06-25', duration: undefined })]);
    const addBtn = el.querySelector<HTMLElement>('.tc-chip-add-date')!;
    click(addBtn);
    const startOption = Array.from(el.querySelectorAll<HTMLElement>('.tc-add-date-menu-item')).find(
      (o) => o.textContent?.includes('Start'),
    )!;
    click(startOption);
    const popover = el.querySelector('.tc-date-popover');
    expect(popover).not.toBeNull();
    expect(popover?.querySelector('input[type="date"]')).not.toBeNull();
  });

  it('clicking "Plan" in the "+" menu opens the same date popover style used for the due-date chip', async () => {
    const { state, el } = await makePanel();
    state.set('taskStack', [task({ text: 'Dated', due: '2026-06-25', duration: undefined })]);
    const addBtn = el.querySelector<HTMLElement>('.tc-chip-add-date')!;
    click(addBtn);
    const planOption = Array.from(el.querySelectorAll<HTMLElement>('.tc-add-date-menu-item')).find(
      (o) => o.textContent?.includes('Plan'),
    )!;
    click(planOption);
    const popover = el.querySelector('.tc-date-popover');
    expect(popover).not.toBeNull();
    expect(popover?.querySelector('input[type="date"]')).not.toBeNull();
  });

  it('setting a Start date via the "+" menu delegates a typed planning command', async () => {
    const ref: TaskRef = { filePath: 'f.md', line: 0, revision: 'revision' };
    const execute = vi.fn<TaskApplicationApi['execute']>().mockResolvedValue({
      type: 'not-found',
      target: { type: 'task', ref },
    });
    const tasks: TaskApplicationApi = {
      queries: {
        list: () => [],
        forCalendarDates: () => [],
        resolve: (target) => ({ type: 'not-found', ref: target }),
        subscribe: () => () => {},
      },
      execute,
    };
    const { state, app, el } = await makePanel({ 'f.md': '- [ ] Dated 📅 2026-06-25\n' }, tasks);
    state.set('taskStack', [
      Object.assign(
        task({
          filePath: 'f.md',
          line: 0,
          text: 'Dated',
          due: '2026-06-25',
          duration: undefined,
          rawText: '- [ ] Dated 📅 2026-06-25',
        }),
        { ref },
      ),
    ]);
    const addBtn = el.querySelector<HTMLElement>('.tc-chip-add-date')!;
    click(addBtn);
    const startOption = Array.from(el.querySelectorAll<HTMLElement>('.tc-add-date-menu-item')).find(
      (o) => o.textContent?.includes('Start'),
    )!;
    click(startOption);
    const input = el.querySelector<HTMLInputElement>('.tc-date-popover .tc-date-input')!;
    input.value = '2026-07-01';
    input.dispatchEvent(new Event('change'));
    await flushMicrotasks();
    expect(execute).toHaveBeenCalledWith({
      type: 'patch',
      target: { type: 'task', ref },
      patch: { start: { type: 'set', value: '2026-07-01' } },
    });
    expect(await readMd(app, 'f.md')).toBe('- [ ] Dated 📅 2026-06-25\n');
  });

  it('a SubTask (no duration field) offers the "+" control for its own unset Start/Plan — not gated on the removed Planning disclosure', async () => {
    const { state, el } = await makePanel();
    const sub: SubTask = {
      filePath: 'f.md',
      line: 1,
      rawText: '  - [ ] sub-thing 📅 2026-07-10',
      text: 'sub-thing',
      markdownText: 'sub-thing',
      status: 'open',
      statusSymbol: ' ',
      priority: 'D',
      due: '2026-07-10', // a real sub-item can carry its own 📅 date via extractMetadata
    };
    // Drill into the sub-task directly, the same way clicking its label would.
    state.set('taskStack', [task({ text: 'Parent', subtasks: [sub] }), sub]);
    expect(el.querySelector('.tc-planning-section')).toBeNull();
    expect(el.querySelector('.tc-chip-start')).toBeNull();
    expect(el.querySelector('.tc-chip-scheduled')).toBeNull();
    expect(el.querySelector('.tc-chip-add-date')).not.toBeNull();
  });

  it('combined time+duration chip shows "time · duration" when both set, just time otherwise', async () => {
    const withBothPanel = await makePanel();
    withBothPanel.state.set('taskStack', [task({ text: 'TD', time: '15:00', duration: 90 })]);
    expect(el2Text(withBothPanel.el, '.tc-chip-time')).toBe('⏰ 15:00 · 1h30m');

    const timeOnlyPanel = await makePanel();
    timeOnlyPanel.state.set('taskStack', [task({ text: 'T', time: '15:00' })]);
    expect(el2Text(timeOnlyPanel.el, '.tc-chip-time')).toBe('⏰ 15:00');
  });
});
