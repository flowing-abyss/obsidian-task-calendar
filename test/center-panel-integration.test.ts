import moment from 'moment';
import { TFile, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { CalendarSettings } from '../src/settings/types';
import { TaskStore } from '../src/store/TaskStore';
import { TodayView } from '../src/views/TodayView';
import { WeekTimeGridView } from '../src/views/WeekTimeGridView';
import {
  createAppWithFiles,
  fixedToday,
  flushMicrotasks,
  freshContainer,
  makeCenterPanelForTest,
  makeStubStore,
  readStoreTasks,
  seedTaskCache,
  task,
  useRealMoment,
} from './helpers';

const TODAY = moment().format('YYYY-MM-DD');
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
  const panel = makeCenterPanelForTest(state, store, app, settings, null as never);
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
    fixedToday(TODAY);
    await call<void>(panel, 'createTask', 'buy milk');
    const content = await readMd(app, 'inbox.md');
    expect(content).toContain(`- [ ] buy milk 📅 ${TODAY}`);
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
    fixedToday(TODAY);
    await call<void>(panel, 'createTask', 'future task');
    const content = await readMd(app, 'inbox.md');
    // CURRENT BEHAVIOR: upcoming uses today's date as the due date (same as 'today')
    expect(content).toContain(`- [ ] future task 📅 ${TODAY}`);
  });

  it("sel='inbox' tag mode appends task line with inboxTag to customFilePath", async () => {
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      addToToday: false,
      customFilePath: 'Inbox.md',
      inbox: { mode: 'tag', tag: '#inbox', removeTagOnAssign: true },
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
      inbox: { mode: 'untagged', tag: '', removeTagOnAssign: true },
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
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        addToToday: true,
        inbox: { mode: 'tag', tag: '#inbox', removeTagOnAssign: true },
        dailyNoteProvider: 'manual',
        manualDailyNotePath: 'periodic/daily/YYYY-MM-DD',
      };
      const { panel, state, app } = await makePanel(
        { [`periodic/daily/${TODAY}.md`]: '# Today\n' },
        settings,
      );
      state.set('selectedList', 'inbox');
      fixedToday(TODAY);
      await call<void>(panel, 'createTask', 'today inbox task');
      const content = await readMd(app, `periodic/daily/${TODAY}.md`);
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
    const target = readStoreTasks(store).find((t) => t.text === 'delete me')!;
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
    const target = readStoreTasks(store)[0]!;
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
    const target = { ...readStoreTasks(store)[0]!, filePath: 'does-not-exist.md' };
    await expect(call<void>(panel, 'deleteTask', target)).resolves.toBeUndefined();
  });

  it('clears taskStack when the deleted task was the stack top', async () => {
    const { panel, state, store } = await makePanel({ 't.md': '- [ ] x' }, DEFAULT_SETTINGS, [
      { path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] },
    ]);
    const target = readStoreTasks(store)[0]!;
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
    const target = readStoreTasks(store)[0]!;
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
    const target = readStoreTasks(store)[0]!;
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
    const target = readStoreTasks(store)[0]!;
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
    expect(readStoreTasks(store)[0]?.due).toBe('2026-06-20');
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
    expect(readStoreTasks(store)[0]?.due).toBe('2026-06-20');
  });

  // Task 26: dropping a previously-timed block onto the all-day/"No-time" row reuses this
  // same onDrop path (renderAllDayCell's generic onDrop callback) — the inverse of Round 2
  // Task 8's setTaskTimeFromDrop. A task carrying ⏰/⏱️ tokens must have both stripped, in
  // addition to the date move every onDrop call already performs.
  it('a previously-timed task dropped onto the all-day row has ⏰ time and ⏱️ duration stripped, date still moved', async () => {
    const { panel, store, app } = await makePanel(
      { 't.md': '- [ ] task 📅 2026-06-20 ⏰ 09:00 ⏱️ 1h30m' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const target = readStoreTasks(store)[0]!;
    expect(target.time).toBe('09:00');
    await call<void>(panel, 'rescheduleTask', `${target.filePath}:::0`, '2026-06-28');
    const content = await readMd(app, 't.md');
    expect(content).toBe('- [ ] task 📅 2026-06-28');
    expect(content).not.toContain('⏰');
    expect(content).not.toContain('⏱️');
  });

  it('a task with time but no duration dropped onto the all-day row strips only ⏰', async () => {
    const { panel, store, app } = await makePanel(
      { 't.md': '- [ ] task 📅 2026-06-20 ⏰ 09:00' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const target = readStoreTasks(store)[0]!;
    await call<void>(panel, 'rescheduleTask', `${target.filePath}:::0`, '2026-06-28');
    const content = await readMd(app, 't.md');
    expect(content).toBe('- [ ] task 📅 2026-06-28');
  });

  it('a task with no time is unaffected by the time/duration-stripping branch (unchanged prior behavior)', async () => {
    const { panel, store, app } = await makePanel(
      { 't.md': '- [ ] task 📅 2026-06-20' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const target = readStoreTasks(store)[0]!;
    await call<void>(panel, 'rescheduleTask', `${target.filePath}:::0`, '2026-06-28');
    const content = await readMd(app, 't.md');
    expect(content).toBe('- [ ] task 📅 2026-06-28');
  });
});

describe('CenterPanel.renderWithGrouping (date grouping)', () => {
  fixedToday('2026-06-25');

  /**
   * Call the private renderWithGrouping directly with groupBy='date' to exercise
   * the bucketing logic in isolation.
   */
  function renderWithGroupingByDate(tasks: Task[]): HTMLElement {
    const store = makeStubStore(tasks) as TaskStoreType;
    const state = new AppState();
    state.set('centerListViewState', {
      groupBy: 'date',
      sortBy: { field: 'date', dir: 'asc' },
      statusGroups: undefined,
      filters: [],
    });
    const panel = makeCenterPanelForTest(state, store, {} as App, DEFAULT_SETTINGS, null as never);
    const container = freshContainer();
    void call<void>(panel, 'renderWithGrouping', container, tasks);
    return container;
  }

  it('buckets tasks into Overdue/Today/Tomorrow/Upcoming with counts', () => {
    const tasks = [
      task({ text: 'overdue', due: '2026-06-20', filePath: 't.md', line: 0 }),
      task({ text: 'today', due: '2026-06-25', filePath: 't.md', line: 1 }),
      task({ text: 'tomorrow', due: '2026-06-26', filePath: 't.md', line: 2 }),
      task({ text: 'upcoming', due: '2026-07-05', filePath: 't.md', line: 3 }),
    ];
    const container = renderWithGroupingByDate(tasks);
    const headers = container.querySelectorAll('.tc-group-header');
    const labels = Array.from(headers).map((h) => h.textContent?.trim());
    expect(labels).toContain('Overdue  1');
    expect(labels).toContain('Today  1');
    expect(labels).toContain('Tomorrow  1');
    expect(labels).toContain('Upcoming  1');
  });

  it('empty groups are skipped (only non-empty groups render)', () => {
    const tasks = [task({ text: 'today only', due: '2026-06-25', filePath: 't.md', line: 0 })];
    const container = renderWithGroupingByDate(tasks);
    const headers = container.querySelectorAll('.tc-group-header');
    const labels = Array.from(headers).map((h) => h.textContent?.trim());
    expect(labels).toEqual(['Today  1']);
  });

  it('no-date task falls into "No date" bucket (not Overdue)', () => {
    const tasks = [task({ text: 'no date', filePath: 't.md', line: 0 })];
    const container = renderWithGroupingByDate(tasks);
    const headers = container.querySelectorAll('.tc-group-header');
    const labels = Array.from(headers).map((h) => h.textContent?.trim());
    expect(labels).toEqual(['No date  1']);
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
    const panel = makeCenterPanelForTest(state, store, {} as App, DEFAULT_SETTINGS, null as never);
    panel.mount(freshContainer());
    const cards = panel['el'].querySelectorAll('.tc-task-card');
    expect(cards).toHaveLength(1);
    // Title renders via MarkdownRenderer (mocked as a noop in tests), so identity
    // is asserted via the card's stable file-path/line dataset instead of title text.
    expect(cards[0]?.querySelector('.tc-task-title')).toBeTruthy();
    expect((cards[0] as HTMLElement).dataset['filePath']).toBe('a.md');
    expect((cards[0] as HTMLElement).dataset['line']).toBe('0');
    panel.destroy();
  });

  it('clicking a result sets selectedList + mode + taskStack on state', () => {
    const t = task({ text: 'buy milk', due: '2026-06-25', filePath: 'a.md', line: 0 });
    const store = makeStubStore([t]) as TaskStoreType;
    const state = new AppState();
    state.set('mode', 'search');
    state.set('searchQuery', 'milk');
    const panel = makeCenterPanelForTest(state, store, {} as App, DEFAULT_SETTINGS, null as never);
    panel.mount(freshContainer());
    const card = panel['el'].querySelector<HTMLElement>('.tc-task-card')!;
    card.click();
    expect(state.get('mode')).toBe('tasks');
    expect(state.get('selectedList')).toBe('today');
    expect(state.get('taskStack')).toEqual([
      expect.objectContaining({ filePath: t.filePath, line: t.line, text: t.text }),
    ]);
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
    const panel = makeCenterPanelForTest(
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

describe('CenterPanel project selection', () => {
  it("sel={type:'project'} filters tasks to that note and titles by basename", async () => {
    const files = {
      'Projects/A.md': '- [ ] task one\n- [ ] task two\n',
      'Other.md': '- [ ] elsewhere\n',
    };
    const seeds = [
      {
        path: 'Projects/A.md',
        items: [
          { task: ' ', parent: -1, line: 0 },
          { task: ' ', parent: -1, line: 1 },
        ],
      },
      { path: 'Other.md', items: [{ task: ' ', parent: -1, line: 0 }] },
    ];
    const { panel, state } = await makePanel(files, DEFAULT_SETTINGS, seeds);
    state.set('selectedList', { type: 'project', path: 'Projects/A.md' });
    const tasks = call<Task[]>(panel, 'getFilteredTasks') as Task[];
    expect(tasks.length).toBe(2);
    expect(tasks.every((t) => t.filePath === 'Projects/A.md')).toBe(true);
    expect(call<string>(panel, 'getTitle')).toBe('A');
  });

  it("sel={type:'project'} createTask appends into the project note", async () => {
    const { panel, state, app } = await makePanel({ 'Projects/A.md': '# Project A\n' });
    state.set('selectedList', { type: 'project', path: 'Projects/A.md' });
    await call<void>(panel, 'createTask', 'write the brief');
    const content = await readMd(app, 'Projects/A.md');
    expect(content).toContain('- [ ] write the brief');
  });

  it("sel={type:'project'} createTask honors the project section-insertion setting", async () => {
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      // Project creation uses the project-specific insertion setting, not the global one.
      projects: {
        ...DEFAULT_SETTINGS.projects,
        taskInsertionMode: 'section',
        taskInsertionSection: '## Tasks',
      },
    };
    const { panel, state, app } = await makePanel(
      { 'Projects/A.md': '# Project A\n\n## Tasks\n- [ ] existing\n' },
      settings,
    );
    state.set('selectedList', { type: 'project', path: 'Projects/A.md' });
    await call<void>(panel, 'createTask', 'under section');
    const content = await readMd(app, 'Projects/A.md');
    const lines = content.split('\n');
    const sectionIdx = lines.findIndex((l) => l.trim() === '## Tasks');
    expect(lines[sectionIdx + 1]).toBe('- [ ] under section');
  });
});

describe('CenterPanel projects mode teardown (regression)', () => {
  function stubProjectStore() {
    return {
      list: () => [],
      get: () => undefined,
      activeForLeftPanel: () => [],
      onUpdate: () => () => {},
      refresh: () => {},
    } as never;
  }
  function stubProjectManager() {
    return { setStatus: async () => {}, create: async () => null } as never;
  }

  async function makeProjectsPanel(): Promise<{
    panel: CenterPanel;
    state: AppState;
    el: HTMLElement;
  }> {
    const app = await createAppWithFiles({ 'Projects/A.md': '---\nstatus: active\n---\n' });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const state = new AppState();
    const panel = makeCenterPanelForTest(
      state,
      store,
      app,
      DEFAULT_SETTINGS,
      null as never,
      async () => {},
      stubProjectStore(),
      stubProjectManager(),
    );
    const el = freshContainer();
    panel.mount(el);
    return { panel, state, el };
  }

  it('mounts the projects panel on a child host, not the shared center element', async () => {
    const { state, el } = await makeProjectsPanel();
    state.set('mode', 'projects');
    // The projects panel class lives on the child host, never on the center el.
    expect(el.classList.contains('tc-projects-panel')).toBe(false);
    expect(el.querySelector('.tc-projects-host .tc-projects-list')).toBeTruthy();
  });

  it('leaving projects mode restores a clean tasks center (no leaked class or DOM)', async () => {
    const { state, el } = await makeProjectsPanel();
    state.set('mode', 'projects');
    // Back to tasks with a tag selection.
    state.set('selectedList', { type: 'tag', tag: '#work' });
    state.set('mode', 'tasks');
    expect(el.classList.contains('tc-projects-panel')).toBe(false);
    expect(el.classList.contains('tc-center--projects')).toBe(false);
    expect(el.querySelector('.tc-projects-host')).toBeNull();
    // Normal tasks-mode header (title + controls) renders again.
    expect(el.querySelector('.tc-center-header')).toBeTruthy();
    expect(el.querySelector('.tc-center-scroll')).toBeTruthy();
  });
});

describe('CenterPanel calendar mode — Today/Week/Month switcher', () => {
  async function makeCalendarPanel(): Promise<{
    panel: CenterPanel;
    state: AppState;
    el: HTMLElement;
    app: App;
  }> {
    const { panel, state, app } = await makePanel(
      { 't.md': '- [ ] task 📅 2026-06-15' },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const el = freshContainer();
    panel.mount(el);
    state.set('mode', 'calendar');
    return { panel, state, el, app };
  }

  it('view switcher shows Day, Week, Month (not Today/Week/Month)', async () => {
    const { el } = await makeCalendarPanel();
    const labels = Array.from(el.querySelectorAll('.tc-cal-view-btn')).map((b) => b.textContent);
    expect(labels).toEqual(['Day', 'Week', 'Month']);
  });

  it('defaults to Month and mounts MonthGridView', async () => {
    const { el } = await makeCalendarPanel();
    expect(el.querySelector('.tc-mg-grid')).not.toBeNull();
  });

  it('clicking Today switches to TodayView', async () => {
    const { el } = await makeCalendarPanel();
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === 'Day',
      ) as HTMLElement
    ).click();
    expect(el.querySelector('.tc-tg-root')).not.toBeNull();
  });

  it('clicking a Month day cell drills into Day (Today) view for that specific date', async () => {
    const { el } = await makeCalendarPanel();
    const cell = el.querySelector(
      '.tc-mg-cell:not(.is-outside-month)[data-mg-date]',
    ) as HTMLElement;
    const date = cell.getAttribute('data-mg-date')!;
    cell.click();
    // A single day column for the clicked date — not a 7-column week — confirms Today, not Week.
    const columns = el.querySelectorAll('.tc-tg-day-column');
    expect(columns).toHaveLength(1);
    expect(columns[0]?.getAttribute('data-tg-date')).toBe(date);
  });

  it('clicking a Week header cell drills into Day (Today) view for that specific date', async () => {
    const { el } = await makeCalendarPanel();
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === 'Week',
      ) as HTMLElement
    ).click();
    const headerCells = Array.from(el.querySelectorAll('.tc-tg-header-cell'));
    expect(headerCells.length).toBeGreaterThan(1); // sanity: still in Week (multi-column)
    const dayColumnsBefore = Array.from(el.querySelectorAll('.tc-tg-day-column'));
    const targetDate = dayColumnsBefore[2]?.getAttribute('data-tg-date');
    (headerCells[2] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const columns = el.querySelectorAll('.tc-tg-day-column');
    expect(columns).toHaveLength(1);
    expect(columns[0]?.getAttribute('data-tg-date')).toBe(targetDate);
  });

  it('clicking inside the all-day band in Week view does not drill into Today (separate row from the header)', async () => {
    const { el } = await makeCalendarPanel();
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === 'Week',
      ) as HTMLElement
    ).click();
    const alldayCell = el.querySelector('.tc-tg-allday-cell') as HTMLElement;
    alldayCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelectorAll('.tc-tg-day-column')).toHaveLength(7);
  });

  it('no 🎨 style-cycle button is rendered in the new calendar toolbar', async () => {
    const { el } = await makeCalendarPanel();
    expect(el.querySelector('.tc-cal-style-btn')).toBeNull();
  });

  it('right-clicking a Month-view checkbox opens the status/priority popover instead of the task-edit modal, and picking a priority mutates the file (onSetPriority wired through store.setPriority)', async () => {
    // The task must fall on a currently-visible day of the default (today's) month, so it's
    // anchored to TODAY rather than makeCalendarPanel's fixed June 2026 seed task.
    const { panel, state, app } = await makePanel(
      { 't.md': `- [ ] task 📅 ${TODAY}` },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const el = freshContainer();
    panel.mount(el);
    state.set('mode', 'calendar');
    const marker = el.querySelector(
      '.tc-mg-plain .tc-status-marker, .tc-mg-deadline-marker .tc-status-marker',
    ) as HTMLElement;
    expect(marker).not.toBeNull();

    // Right-click the checkbox: opens the popover, not the TaskModal (no modal container appended).
    marker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const popover = document.querySelector('.tc-status-popover');
    expect(popover).not.toBeNull();
    expect(document.querySelector('.modal')).toBeNull();

    const flagBtn = popover!.querySelector(
      '.tc-status-popover-flag[data-tc-priority="A"]',
    ) as HTMLElement;
    expect(flagBtn).not.toBeNull();
    flagBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushMicrotasks();

    const content = await readMd(app, 't.md');
    expect(content).toContain('🔺');
  });
});

describe('CenterPanel calendar mode — scroll-to-now dedup (Task 27)', () => {
  async function makeCalendarPanel(): Promise<{
    panel: CenterPanel;
    state: AppState;
    store: TaskStore;
    el: HTMLElement;
    app: App;
  }> {
    const { panel, state, app } = await makePanel(
      { 't.md': `- [ ] task 📅 ${TODAY}` },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const el = freshContainer();
    panel.mount(el);
    state.set('mode', 'calendar');
    // Grab the real TaskStore instance CenterPanel was built with (see makePanel above).
    const store = (panel as unknown as { store: TaskStore }).store;
    return { panel, state, store, el, app };
  }

  function clickViewBtn(el: HTMLElement, label: 'Day' | 'Week' | 'Month'): void {
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === label,
      ) as HTMLElement
    ).click();
  }

  function lastShouldScrollToNow(spy: { mock: { calls: unknown[][] } }): unknown {
    const calls = spy.mock.calls;
    const lastCall = calls[calls.length - 1];
    return lastCall?.[3];
  }

  it('switching into Week view for the first time scrolls (shouldScrollToNow=true)', async () => {
    const renderSpy = vi.spyOn(WeekTimeGridView.prototype, 'render');
    const { el } = await makeCalendarPanel();
    clickViewBtn(el, 'Week');
    expect(lastShouldScrollToNow(renderSpy)).toBe(true);
    renderSpy.mockRestore();
  });

  it('a reactive TaskStore update re-render of the same view/date does not scroll again', async () => {
    const renderSpy = vi.spyOn(WeekTimeGridView.prototype, 'render');
    const { el, store } = await makeCalendarPanel();
    clickViewBtn(el, 'Week');
    expect(lastShouldScrollToNow(renderSpy)).toBe(true);

    // Simulate a store-driven re-render (e.g. toggling a checkbox anywhere), which routes
    // through the `store.onUpdate` subscription in renderCalendarMode -> mountView(), NOT
    // through CenterPanel.render() — this is the exact path the brief's root cause describes.
    const seededTask = readStoreTasks(store, { filePath: 't.md' })[0]!;
    await store.toggleTask(seededTask);
    await flushMicrotasks();

    expect(lastShouldScrollToNow(renderSpy)).toBe(false);
    renderSpy.mockRestore();
  });

  it('switching view type (Week -> Day -> Week) scrolls again each time, since it is a new pair', async () => {
    const weekSpy = vi.spyOn(WeekTimeGridView.prototype, 'render');
    const todaySpy = vi.spyOn(TodayView.prototype, 'render');
    const { el } = await makeCalendarPanel();

    clickViewBtn(el, 'Week');
    expect(lastShouldScrollToNow(weekSpy)).toBe(true);

    clickViewBtn(el, 'Day');
    expect(lastShouldScrollToNow(todaySpy)).toBe(true);

    clickViewBtn(el, 'Week');
    expect(lastShouldScrollToNow(weekSpy)).toBe(true);

    weekSpy.mockRestore();
    todaySpy.mockRestore();
  });

  it('navigating to a different date (next week) scrolls again, since it is a new pair', async () => {
    const renderSpy = vi.spyOn(WeekTimeGridView.prototype, 'render');
    const { el } = await makeCalendarPanel();
    clickViewBtn(el, 'Week');
    expect(lastShouldScrollToNow(renderSpy)).toBe(true);

    const nextBtn = el.querySelector('.tc-cal-nav-btn[aria-label="Next"]') as HTMLElement;
    expect(nextBtn).not.toBeNull();
    nextBtn.click();

    expect(lastShouldScrollToNow(renderSpy)).toBe(true);
    renderSpy.mockRestore();
  });

  it("Round 2 Task 16's periodic now-line-repositioning interval is unaffected: it still registers on a scroll-suppressed reactive re-render", async () => {
    const { el, store } = await makeCalendarPanel();
    clickViewBtn(el, 'Week');

    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    // Same view/date -> shouldScrollToNow will be false on this reactive re-render, but the
    // now-line interval must still be torn down (old view destroy()) and re-registered (new
    // view render()) exactly as before this change.
    const seededTask = readStoreTasks(store, { filePath: 't.md' })[0]!;
    await store.toggleTask(seededTask);
    await flushMicrotasks();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

describe('CenterPanel calendar mode — preserve scroll position across reactive re-render (Task 31)', () => {
  async function makeCalendarPanel(): Promise<{
    panel: CenterPanel;
    state: AppState;
    store: TaskStore;
    el: HTMLElement;
    app: App;
  }> {
    const { panel, state, app } = await makePanel(
      { 't.md': `- [ ] task 📅 ${TODAY}` },
      DEFAULT_SETTINGS,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const el = freshContainer();
    panel.mount(el);
    state.set('mode', 'calendar');
    const store = (panel as unknown as { store: TaskStore }).store;
    return { panel, state, store, el, app };
  }

  function clickViewBtn(el: HTMLElement, label: 'Day' | 'Week' | 'Month'): void {
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === label,
      ) as HTMLElement
    ).click();
  }

  it('a reactive re-render (checkbox toggle elsewhere) preserves the exact scrollTop the user had, instead of resetting to 0', async () => {
    const { el, store } = await makeCalendarPanel();
    clickViewBtn(el, 'Week');

    const gridRowEl = el.querySelector('.tc-tg-grid-row') as HTMLElement;
    expect(gridRowEl).not.toBeNull();
    // Simulate the user having scrolled away from "now" to some arbitrary position.
    gridRowEl.scrollTop = 777;
    expect(gridRowEl.scrollTop).toBe(777);

    // Reactive re-render of the SAME view/date, via store.onUpdate -> mountView(), exactly the
    // path a checkbox toggle anywhere in the vault takes (not through CenterPanel.render()).
    const seededTask = readStoreTasks(store, { filePath: 't.md' })[0]!;
    await store.toggleTask(seededTask);
    await flushMicrotasks();

    const newGridRowEl = el.querySelector('.tc-tg-grid-row') as HTMLElement;
    expect(newGridRowEl).not.toBeNull();
    // A brand-new DOM element (destroy/recreate cycle), but its scrollTop must equal the OLD
    // value — not 0, and not re-centered on "now".
    expect(newGridRowEl).not.toBe(gridRowEl);
    expect(newGridRowEl.scrollTop).toBe(777);
  });

  it('a genuine navigation to a new view/date (Week -> Day) does not inherit the stale prior scroll position', async () => {
    const { el } = await makeCalendarPanel();
    clickViewBtn(el, 'Week');

    const gridRowEl = el.querySelector('.tc-tg-grid-row') as HTMLElement;
    gridRowEl.scrollTop = 777;

    // Genuine navigation: switching view type is a new (viewType, date) pair, so
    // shouldScrollToNow is true here and must take priority over any stale prior scrollTop.
    clickViewBtn(el, 'Day');

    const newGridRowEl = el.querySelector('.tc-tg-grid-row') as HTMLElement;
    expect(newGridRowEl).not.toBeNull();
    expect(newGridRowEl).not.toBe(gridRowEl);
    // Must NOT equal the stale Week-view scrollTop (777) it never asked to inherit.
    expect(newGridRowEl.scrollTop).not.toBe(777);
  });

  it('switching from Month (no grid-row) into Week does not error and scrolls to now as a fresh navigation', async () => {
    const { el } = await makeCalendarPanel();
    // Default calViewType is 'month' — no `.tc-tg-grid-row` exists yet.
    expect(el.querySelector('.tc-tg-grid-row')).toBeNull();

    clickViewBtn(el, 'Week');
    const gridRowEl = el.querySelector('.tc-tg-grid-row') as HTMLElement;
    expect(gridRowEl).not.toBeNull();
  });
});

describe('CenterPanel calendar mode — click-to-create', () => {
  const clickToCreateSettings: CalendarSettings = {
    ...DEFAULT_SETTINGS,
    addToToday: false,
    customFilePath: 'inbox.md',
    taskPrefix: '',
  };

  async function makeClickToCreatePanel(): Promise<{ state: AppState; el: HTMLElement; app: App }> {
    const { panel, state, app } = await makePanel({ 'inbox.md': '' }, clickToCreateSettings);
    const el = freshContainer();
    panel.mount(el);
    state.set('mode', 'calendar');
    return { state, el, app };
  }

  it("Month day cell's + button opens an inline quick-add; Enter writes a plain task on that date", async () => {
    const { el, app } = await makeClickToCreatePanel();
    const cell = el.querySelector(
      '.tc-mg-cell:not(.is-outside-month)[data-mg-date]',
    ) as HTMLElement;
    const date = cell.getAttribute('data-mg-date')!;
    const addBtn = cell.querySelector('.tc-mg-add-btn') as HTMLElement;
    addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const input = el.querySelector('.tc-mg-quick-add-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'water the plants';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushMicrotasks();

    const content = await readMd(app, 'inbox.md');
    expect(content).toContain(`- [ ] water the plants 📅 ${date}`);
  });

  it('clicking the + button does not also drill into Week (onDayClick suppressed)', async () => {
    const { el } = await makeClickToCreatePanel();
    const cell = el.querySelector(
      '.tc-mg-cell:not(.is-outside-month)[data-mg-date]',
    ) as HTMLElement;
    const addBtn = cell.querySelector('.tc-mg-add-btn') as HTMLElement;
    addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Still on Month (a drill-down would swap in the hour grid).
    expect(el.querySelector('.tc-mg-grid')).not.toBeNull();
    expect(el.querySelector('.tc-tg-day-column')).toBeNull();
  });

  it('clicking elsewhere in a Month day cell still drills into Day (Today) view, unaffected by the + button', async () => {
    const { el } = await makeClickToCreatePanel();
    const cell = el.querySelector(
      '.tc-mg-cell:not(.is-outside-month)[data-mg-date]',
    ) as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelectorAll('.tc-tg-day-column')).toHaveLength(1);
  });

  it('clicking empty hour-grid space in Today view opens an inline quick-add; Enter writes a timed task', async () => {
    const { el, app } = await makeClickToCreatePanel();
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === 'Day',
      ) as HTMLElement
    ).click();

    const hourColumnEl = el.querySelector('.tc-tg-hour-column') as HTMLElement;
    const date = (el.querySelector('.tc-tg-day-column') as HTMLElement).getAttribute(
      'data-tg-date',
    )!;
    vi.spyOn(hourColumnEl, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
    } as DOMRect);
    hourColumnEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 480 })); // 480px = 10:00

    const input = el.querySelector('.tc-tg-quick-add-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'stand-up';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushMicrotasks();

    const content = await readMd(app, 'inbox.md');
    expect(content).toContain(`- [ ] stand-up ⏰ 10:00 📅 ${date}`);
  });

  it('clicking on an existing timed block in the hour grid does not open the quick-add', async () => {
    const { panel, state } = await makePanel(
      { 't.md': `- [ ] timed ⏰ 09:00 📅 ${TODAY}` },
      clickToCreateSettings,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    const el = freshContainer();
    panel.mount(el);
    state.set('mode', 'calendar');
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === 'Day',
      ) as HTMLElement
    ).click();

    const block = el.querySelector('.tc-tg-block') as HTMLElement;
    expect(block).toBeTruthy();
    block.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelector('.tc-tg-quick-add')).toBeNull();
  });

  it('clicking empty space in the all-day/"no-time" row in Today view opens an inline quick-add; Enter writes a plain (untimed) task', async () => {
    const { el, app } = await makeClickToCreatePanel();
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === 'Day',
      ) as HTMLElement
    ).click();

    const alldayCell = el.querySelector('.tc-tg-allday-cell') as HTMLElement;
    const date = (el.querySelector('.tc-tg-day-column') as HTMLElement).getAttribute(
      'data-tg-date',
    )!;
    alldayCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const input = el.querySelector('.tc-tg-allday-quick-add-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'renew passport';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushMicrotasks();

    const content = await readMd(app, 'inbox.md');
    expect(content).toContain(`- [ ] renew passport 📅 ${date}`);
  });

  it('clicking empty space in the all-day row in Week view opens an inline quick-add; Enter writes a plain task on that day', async () => {
    const { el, app } = await makeClickToCreatePanel();
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === 'Week',
      ) as HTMLElement
    ).click();

    const alldayCell = el.querySelector('.tc-tg-allday-cell') as HTMLElement;
    const date = alldayCell.getAttribute('data-tg-date')!;
    alldayCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const input = el.querySelector('.tc-tg-allday-quick-add-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'water plants';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushMicrotasks();

    const content = await readMd(app, 'inbox.md');
    expect(content).toContain(`- [ ] water plants 📅 ${date}`);
  });

  it('clicking on an existing item in the all-day row does not open the quick-add (guarded, same as the hour grid)', async () => {
    const { panel, state } = await makePanel(
      { 't.md': `- [ ] plain task 📅 ${TODAY}` },
      clickToCreateSettings,
      [{ path: 't.md', items: [{ task: ' ', parent: -1, line: 0 }] }],
    );
    fixedToday(TODAY);
    const el = freshContainer();
    panel.mount(el);
    state.set('mode', 'calendar');
    (
      Array.from(el.querySelectorAll('.tc-cal-view-btn')).find(
        (b) => b.textContent === 'Day',
      ) as HTMLElement
    ).click();

    const chip = el.querySelector('.tc-tg-plain') as HTMLElement;
    expect(chip).toBeTruthy();
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelector('.tc-tg-allday-quick-add')).toBeNull();
  });
});
