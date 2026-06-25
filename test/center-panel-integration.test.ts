import { TFile, type App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { CalendarSettings } from '../src/settings/types';
import { TaskStore } from '../src/store/TaskStore';
import {
  createAppWithFiles,
  fixedToday,
  freshContainer,
  makeStubStore,
  seedTaskCache,
  task,
  useRealMoment,
} from './helpers';
type TaskStoreType = TaskStore;

const hasAddRawLine =
  typeof (TaskStore.prototype as unknown as Record<string, unknown>).addRawLine === 'function';

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
function call<T>(panel: CenterPanel, method: string, ...args: unknown[]): Promise<T> | T {
  const fn = (panel as unknown as Record<string, (...a: unknown[]) => T>)[method]!;
  return fn.call(panel, ...args);
}

/**
 * Wire up a real CenterPanel + real TaskStore + real AppState.
 * Vault is pre-populated with `files`; each seeded file also gets a task cache.
 */
async function makePanel(
  files: Record<string, string>,
  settings: CalendarSettings = DEFAULT_SETTINGS,
  seeds: Array<{ path: string; items: Array<{ task: string; parent: number; line: number }> }> = [],
): Promise<{ panel: CenterPanel; state: AppState; store: TaskStore; app: App }> {
  const app = await createAppWithFiles(files);
  for (const s of seeds) seedTaskCache(app, s.path, s.items);
  const store = new TaskStore(app, settings);
  await store.initialize();
  const state = new AppState();
  const panel = new CenterPanel(state, store, app, settings, null as never);
  return { panel, state, store, app };
}

describe('CenterPanel.createTask', () => {
  it("sel='today' delegates to store.addTask (writes to customFilePath when addToToday=false)", async () => {
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      addToToday: false,
      customFilePath: 'inbox.md',
      taskPrefix: '',
    };
    const { panel, state, app } = await makePanel({ 'inbox.md': '- [ ] existing' }, settings);
    state.set('selectedList', 'today');
    fixedToday('2026-06-25');
    await call<void>(panel, 'createTask', 'buy milk');
    const content = await readMd(app, 'inbox.md');
    expect(content).toContain('- [ ] buy milk 📅 2026-06-25');
  });

  it("sel='upcoming' delegates to store.addTask (same path as today — CURRENT BEHAVIOR)", async () => {
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      addToToday: false,
      customFilePath: 'inbox.md',
      taskPrefix: '',
    };
    const { panel, state, app } = await makePanel({ 'inbox.md': '' }, settings);
    state.set('selectedList', 'upcoming');
    fixedToday('2026-06-25');
    await call<void>(panel, 'createTask', 'future task');
    const content = await readMd(app, 'inbox.md');
    // CURRENT BEHAVIOR: upcoming uses today's date as the due date (same as 'today')
    expect(content).toContain('- [ ] future task 📅 2026-06-25');
  });

  it("sel='inbox' tag mode appends task line with inboxTag to customFilePath", async () => {
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      addToToday: false,
      customFilePath: 'Inbox.md',
      inbox: { mode: 'tag', tag: '#inbox', showUntagged: false, removeTagOnAssign: true },
    };
    const { panel, state, app } = await makePanel({ 'Inbox.md': '- [ ] existing' }, settings);
    state.set('selectedList', 'inbox');
    await call<void>(panel, 'createTask', 'new inbox task');
    const content = await readMd(app, 'Inbox.md');
    expect(content).toContain('- [ ] new inbox task #inbox');
  });

  it("sel='inbox' untagged mode appends plain task line to customFilePath", async () => {
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      addToToday: false,
      customFilePath: 'Inbox.md',
      inbox: { mode: 'untagged', tag: '', showUntagged: true, removeTagOnAssign: true },
    };
    const { panel, state, app } = await makePanel({ 'Inbox.md': '- [ ] existing' }, settings);
    state.set('selectedList', 'inbox');
    await call<void>(panel, 'createTask', 'plain task');
    const content = await readMd(app, 'Inbox.md');
    expect(content).toContain('- [ ] plain task');
    expect(content).not.toContain('#inbox');
  });

  it("sel={type:'tag'} appends task line with the tag to customFilePath", async () => {
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      addToToday: false,
      customFilePath: 'Inbox.md',
    };
    const { panel, state, app } = await makePanel({ 'Inbox.md': '' }, settings);
    state.set('selectedList', { type: 'tag', tag: '#work' });
    await call<void>(panel, 'createTask', 'tagged task');
    const content = await readMd(app, 'Inbox.md');
    expect(content).toContain('- [ ] tagged task #work');
  });

  (hasAddRawLine ? it : it.skip)(
    'addToToday=true routes inbox task line through store.addRawLine (resolver)',
    async () => {
      const today = '2026-06-25';
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        addToToday: true,
        inbox: { mode: 'tag', tag: '#inbox', showUntagged: false, removeTagOnAssign: true },
        dailyNoteProvider: 'manual',
        manualDailyNotePath: 'periodic/daily/YYYY-MM-DD',
      };
      const { panel, state, app } = await makePanel(
        { [`periodic/daily/${today}.md`]: '# Today\n' },
        settings,
      );
      state.set('selectedList', 'inbox');
      fixedToday(today);
      await call<void>(panel, 'createTask', 'today inbox task');
      const content = await readMd(app, `periodic/daily/${today}.md`);
      expect(content).toContain('- [ ] today inbox task #inbox');
    },
  );
});

describe('CenterPanel.deleteTask', () => {
  it('single-line task (no subtaskRange) removes exactly one line', async () => {
    const { panel, store, app } = await makePanel(
      { 't.md': '- [ ] keep\n- [ ] delete me\n- [ ] keep2' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 1 }] }],
    );
    const target = store.getTasks().find((t) => t.text === 'delete me')!;
    await call<void>(panel, 'deleteTask', target);
    const content = await readMd(app, 't.md');
    expect(content).toBe('- [ ] keep\n- [ ] keep2');
  });

  it('multi-line task (with subtaskRange) removes the whole block', async () => {
    // Root task at line 0, subtask at line 1 (indented); subtaskRange {from:0,to:1}
    const content = '- [ ] parent\n    - [ ] sub\n- [ ] other';
    const { panel, store, app } = await makePanel({ 't.md': content }, DEFAULT_SETTINGS, [
      { path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] },
    ]);
    const target = store.getTasks()[0]!;
    // Force subtaskRange to cover both lines
    const withRange: Task = { ...target, subtaskRange: { from: 0, to: 1 } };
    await call<void>(panel, 'deleteTask', withRange);
    const after = await readMd(app, 't.md');
    expect(after).toBe('- [ ] other');
  });

  it('file not found (task.filePath missing from vault) is a no-op', async () => {
    const { panel, store } = await makePanel({ 't.md': '- [ ] x' }, DEFAULT_SETTINGS, [
      { path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] },
    ]);
    const target = { ...store.getTasks()[0]!, filePath: 'does-not-exist.md' };
    await expect(call<void>(panel, 'deleteTask', target)).resolves.toBeUndefined();
  });

  it('clears taskStack when the deleted task was the stack top', async () => {
    const { panel, state, store } = await makePanel({ 't.md': '- [ ] x' }, DEFAULT_SETTINGS, [
      { path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] },
    ]);
    const target = store.getTasks()[0]!;
    state.set('taskStack', [target]);
    await call<void>(panel, 'deleteTask', target);
    expect(state.get('taskStack')).toEqual([]);
  });
});

describe('CenterPanel.rescheduleTask', () => {
  it('task with due date → 📅 replaced with targetDate', async () => {
    const { panel, store, app } = await makePanel(
      { 't.md': '- [ ] task 📅 2026-06-20' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const target = store.getTasks()[0]!;
    await call<void>(panel, 'rescheduleTask', `${target.filePath}:::0`, '2026-06-28');
    const content = await readMd(app, 't.md');
    expect(content).toBe('- [ ] task 📅 2026-06-28');
  });

  it('task with scheduled (no due) → ⏳ replaced with targetDate', async () => {
    const { panel, store, app } = await makePanel(
      { 't.md': '- [ ] task ⏳ 2026-06-20' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const target = store.getTasks()[0]!;
    await call<void>(panel, 'rescheduleTask', `${target.filePath}:::0`, '2026-06-28');
    const content = await readMd(app, 't.md');
    expect(content).toBe('- [ ] task ⏳ 2026-06-28');
  });

  it('task with no due/scheduled → 📅 targetDate appended', async () => {
    const { panel, store, app } = await makePanel(
      { 't.md': '- [ ] plain task' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const target = store.getTasks()[0]!;
    await call<void>(panel, 'rescheduleTask', `${target.filePath}:::0`, '2026-06-28');
    const content = await readMd(app, 't.md');
    expect(content).toBe('- [ ] plain task 📅 2026-06-28');
  });

  it('invalid dragData (no ::: separator) → no-op', async () => {
    const { panel, store, app } = await makePanel(
      { 't.md': '- [ ] task 📅 2026-06-20' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    await call<void>(panel, 'rescheduleTask', 'bogus', '2026-06-28');
    const content = await readMd(app, 't.md');
    expect(content).toBe('- [ ] task 📅 2026-06-20');
    expect(store.getTasks()[0]?.due).toBe('2026-06-20');
  });

  it('task not found in store → no-op', async () => {
    const { panel, store, app } = await makePanel(
      { 't.md': '- [ ] task 📅 2026-06-20' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    // Reference a line that doesn't match any parsed task
    await call<void>(panel, 'rescheduleTask', 't.md:::999', '2026-06-28');
    const content = await readMd(app, 't.md');
    expect(content).toBe('- [ ] task 📅 2026-06-20');
    expect(store.getTasks()[0]?.due).toBe('2026-06-20');
  });
});

describe('CenterPanel.renderGrouped', () => {
  fixedToday('2026-06-25');

  /**
   * Call the private renderGrouped directly with a crafted task list so we exercise
   * the bucketing logic in isolation (the public render() path pre-filters via
   * getFilteredTasks, which excludes tomorrow/upcoming from the 'today' selection).
   */
  function renderGrouped(tasks: Task[]): HTMLElement {
    const store = makeStubStore(tasks) as TaskStoreType;
    const state = new AppState();
    const panel = new CenterPanel(state, store, {} as App, DEFAULT_SETTINGS, null as never);
    const container = freshContainer();
    void call<void>(panel, 'renderGrouped', container, tasks);
    return container;
  }

  it('buckets tasks into Overdue/Today/Tomorrow/Upcoming with counts', () => {
    const tasks = [
      task({ text: 'overdue', due: '2026-06-20', filePath: 't.md', line: 0 }),
      task({ text: 'today', due: '2026-06-25', filePath: 't.md', line: 1 }),
      task({ text: 'tomorrow', due: '2026-06-26', filePath: 't.md', line: 2 }),
      task({ text: 'upcoming', due: '2026-07-05', filePath: 't.md', line: 3 }),
    ];
    const container = renderGrouped(tasks);
    const headers = container.querySelectorAll('.tc-group-header');
    const labels = Array.from(headers).map((h) => h.textContent?.trim());
    expect(labels).toContain('Overdue  1');
    expect(labels).toContain('Today  1');
    expect(labels).toContain('Tomorrow  1');
    expect(labels).toContain('Upcoming  1');
  });

  it('empty groups are skipped (only non-empty groups render)', () => {
    const tasks = [task({ text: 'today only', due: '2026-06-25', filePath: 't.md', line: 0 })];
    const container = renderGrouped(tasks);
    const headers = container.querySelectorAll('.tc-group-header');
    const labels = Array.from(headers).map((h) => h.textContent?.trim());
    expect(labels).toEqual(['Today  1']);
  });

  it('no-date task falls into Overdue bucket (CURRENT BEHAVIOR, follow-up: FU-23)', () => {
    const tasks = [task({ text: 'no date', filePath: 't.md', line: 0 })];
    const container = renderGrouped(tasks);
    const headers = container.querySelectorAll('.tc-group-header');
    const labels = Array.from(headers).map((h) => h.textContent?.trim());
    // FU-23: tasks with no date land in Overdue because `!d || d < today` is true when d is undefined
    expect(labels).toEqual(['Overdue  1']);
  });
});

describe('CenterPanel.renderSearch', () => {
  fixedToday('2026-06-25');

  it('renders matching task cards for a query', () => {
    const tasks = [
      task({ text: 'buy milk', filePath: 'a.md', line: 0 }),
      task({ text: 'walk dog', filePath: 'b.md', line: 0 }),
    ];
    const store = makeStubStore(tasks) as TaskStoreType;
    const state = new AppState();
    state.set('mode', 'search');
    state.set('searchQuery', 'milk');
    const panel = new CenterPanel(state, store, {} as App, DEFAULT_SETTINGS, null as never);
    panel.mount(freshContainer());
    const cards = panel['el'].querySelectorAll('.tc-task-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.querySelector('.tc-task-title')?.textContent).toContain('buy milk');
    panel.destroy();
  });

  it('clicking a result sets selectedList + mode + taskStack on state', () => {
    const t = task({ text: 'buy milk', due: '2026-06-25', filePath: 'a.md', line: 0 });
    const store = makeStubStore([t]) as TaskStoreType;
    const state = new AppState();
    state.set('mode', 'search');
    state.set('searchQuery', 'milk');
    const panel = new CenterPanel(state, store, {} as App, DEFAULT_SETTINGS, null as never);
    panel.mount(freshContainer());
    const card = panel['el'].querySelector<HTMLElement>('.tc-task-card')!;
    card.click();
    expect(state.get('mode')).toBe('tasks');
    expect(state.get('selectedList')).toBe('today');
    expect(state.get('taskStack')).toEqual([t]);
    panel.destroy();
  });
});

describe('CenterPanel source note chip', () => {
  fixedToday('2026-06-25');

  function makeSearchPanel(
    tasks: Task[],
    settingsOverrides: Partial<typeof DEFAULT_SETTINGS> = {},
  ): CenterPanel {
    const store = makeStubStore(tasks) as TaskStoreType;
    const state = new AppState();
    state.set('mode', 'search');
    state.set('searchQuery', tasks[0]?.text ?? '');
    const panel = new CenterPanel(
      state,
      store,
      {} as App,
      {
        ...DEFAULT_SETTINGS,
        ...settingsOverrides,
      },
      null as never,
    );
    panel.mount(freshContainer());
    return panel;
  }

  it('sourceNoteDisplay always → chip shown for daily note task', () => {
    const t = task({
      text: 'daily task',
      filePath: 'periodic/daily/2026-06-25.md',
      dailyNoteDate: '2026-06-25',
      due: '2026-06-25',
    });
    const panel = makeSearchPanel([t], { sourceNoteDisplay: 'always' });
    expect(panel['el'].querySelector('.tc-task-source-note')).not.toBeNull();
    panel.destroy();
  });

  it('sourceNoteDisplay never → no chip', () => {
    const t = task({ text: 'project task', filePath: 'Projects/alpha.md', due: '2026-06-25' });
    const panel = makeSearchPanel([t], { sourceNoteDisplay: 'never' });
    expect(panel['el'].querySelector('.tc-task-source-note')).toBeNull();
    panel.destroy();
  });

  it('sourceNoteDisplay non-default → chip for project note', () => {
    const t = task({ text: 'project task', filePath: 'Projects/alpha.md', due: '2026-06-25' });
    const panel = makeSearchPanel([t], { sourceNoteDisplay: 'non-default' });
    const chip = panel['el'].querySelector('.tc-task-source-note');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('alpha');
    panel.destroy();
  });

  it('sourceNoteDisplay non-default → no chip for daily note task', () => {
    const t = task({
      text: 'daily task',
      filePath: 'periodic/daily/2026-06-25.md',
      dailyNoteDate: '2026-06-25',
      due: '2026-06-25',
    });
    const panel = makeSearchPanel([t], { sourceNoteDisplay: 'non-default' });
    expect(panel['el'].querySelector('.tc-task-source-note')).toBeNull();
    panel.destroy();
  });

  it('chip appears before tag in tc-task-meta-right', () => {
    const t = task({
      text: 'project task',
      filePath: 'Projects/alpha.md',
      rawText: '- [ ] project task #work',
      due: '2026-06-25',
    });
    const panel = makeSearchPanel([t], { sourceNoteDisplay: 'always' });
    const meta = panel['el'].querySelector('.tc-task-meta-right');
    expect(meta).not.toBeNull();
    const children = Array.from(meta!.children);
    const noteIdx = children.findIndex((el) => el.classList.contains('tc-task-source-note'));
    const tagIdx = children.findIndex((el) => el.classList.contains('tc-task-tag'));
    expect(noteIdx).toBeGreaterThanOrEqual(0);
    expect(tagIdx).toBeGreaterThan(noteIdx);
    panel.destroy();
  });
});
