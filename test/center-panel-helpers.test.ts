import moment from 'moment';
import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS, getListViewDefaults } from '../src/settings/defaults';
import type { CalendarSettings, TagGroup } from '../src/settings/types';
import type { TaskStore } from '../src/store/TaskStore';
import { fixedToday, makeCenterPanelForTest, makeStubStore, task, useRealMoment } from './helpers';

const TODAY = moment().format('YYYY-MM-DD');

useRealMoment();

/**
 * Construct a CenterPanel wired to a stub store + real AppState + DEFAULT_SETTINGS.
 * Pure helpers don't touch the DOM or vault, so `app` is a minimal stub.
 */
function makePanel(
  tasks: Task[],
  settings: CalendarSettings = DEFAULT_SETTINGS,
  state: AppState = new AppState(),
): { panel: CenterPanel; state: AppState } {
  const store = makeStubStore(tasks) as TaskStore;
  const app = {} as App;
  const panel = makeCenterPanelForTest(state, store, app, settings, null as never);
  return { panel, state };
}

/** Bracket-access helper to call private methods (preserves `this` binding). */
function call<T>(panel: CenterPanel, method: string, ...args: unknown[]): T {
  const fn = (panel as unknown as Record<string, (...a: unknown[]) => T>)[method]!;
  return fn.call(panel, ...args);
}

describe('CenterPanel pure helpers', () => {
  describe('getFilteredTasks', () => {
    it('inbox delegates to getInboxTasks (untagged mode excludes tagged)', () => {
      const tasks = [
        task({ text: 'no tag', rawText: '- [ ] no tag' }),
        task({ text: 'tagged', rawText: '- [ ] tagged #work' }),
      ];
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        inbox: { mode: 'untagged', tag: '', removeTagOnAssign: false },
      };
      const { panel, state } = makePanel(tasks, settings);
      state.set('selectedList', 'inbox');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['no tag']);
    });

    it('today includes tasks due/scheduled/dailyNoteDate today', () => {
      const tasks = [
        task({ text: 'dueToday', rawText: '- [ ] dueToday', due: TODAY }),
        task({ text: 'schedToday', rawText: '- [ ] schedToday', scheduled: TODAY }),
        task({ text: 'dnToday', rawText: '- [ ] dnToday', dailyNoteDate: TODAY }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'today');
      fixedToday(TODAY);
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text).sort((a, b) => a.localeCompare(b))).toEqual([
        'dnToday',
        'dueToday',
        'schedToday',
      ]);
    });

    it('today includes overdue (due < today)', () => {
      const tasks = [task({ text: 'overdue', rawText: '- [ ] overdue', due: '2026-06-20' })];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'today');
      fixedToday('2026-06-25');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['overdue']);
    });

    it('today does NOT include overdue via scheduled/dailyNoteDate only (CURRENT BEHAVIOR: only due<today counts as overdue, follow-up: FU-31)', () => {
      const tasks = [
        task({
          text: 'sched-overdue',
          rawText: '- [ ] sched-overdue',
          scheduled: '2026-06-20',
          due: undefined,
        }),
        task({
          text: 'dn-overdue',
          rawText: '- [ ] dn-overdue',
          dailyNoteDate: '2026-06-20',
          due: undefined,
        }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'today');
      fixedToday('2026-06-25');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      // FU-31: only t.due < today triggers overdue inclusion; scheduled/dailyNoteDate overdue are NOT included
      expect(result).toHaveLength(0);
    });

    it('today excludes done tasks', () => {
      const tasks = [
        task({
          text: 'done',
          rawText: '- [x] done',
          status: 'done',
          statusSymbol: 'x',
          due: '2026-06-25',
        }),
        task({ text: 'open', rawText: '- [ ] open', due: '2026-06-25' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'today');
      fixedToday('2026-06-25');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['open']);
    });

    it('today excludes future tasks (due > today, not overdue)', () => {
      // Date relative to "now" so the test stays correct as real time passes.
      const future = moment().add(5, 'days').format('YYYY-MM-DD');
      const tasks = [task({ text: 'future', rawText: '- [ ] future', due: future })];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'today');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result).toHaveLength(0);
    });

    it('upcoming returns open tasks with date > today, sorted', () => {
      // Dates relative to "now" so the test stays correct as real time passes.
      const near = moment().add(3, 'days').format('YYYY-MM-DD');
      const far = moment().add(15, 'days').format('YYYY-MM-DD');
      const past = moment().subtract(5, 'days').format('YYYY-MM-DD');
      const tasks = [
        task({ text: 'far', rawText: '- [ ] far', due: far }),
        task({ text: 'near', rawText: '- [ ] near', due: near }),
        task({ text: 'past', rawText: '- [ ] past', due: past }),
        task({ text: 'done', rawText: '- [x] done', status: 'done', statusSymbol: 'x', due: near }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'upcoming');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['near', 'far']);
    });

    it('upcoming uses due ?? scheduled ?? dailyNoteDate', () => {
      // Dates relative to "now" so the test stays correct as real time passes.
      const sched = moment().add(3, 'days').format('YYYY-MM-DD');
      const dn = moment().add(4, 'days').format('YYYY-MM-DD');
      const tasks = [
        task({ text: 'sched', rawText: '- [ ] sched', scheduled: sched }),
        task({ text: 'dn', rawText: '- [ ] dn', dailyNoteDate: dn }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'upcoming');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['sched', 'dn']);
    });

    it('default string selection returns all open tasks', () => {
      // 'today' is a known string; use a non-matching string by casting
      const tasks = [
        task({ text: 'open', rawText: '- [ ] open' }),
        task({ text: 'done', rawText: '- [x] done', status: 'done', statusSymbol: 'x' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'unknown-list' as unknown as 'inbox');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['open']);
    });

    it('{type:"tag"} filters query snapshots by tag and open status', () => {
      const tasks = [
        task({ text: 'work', rawText: '- [ ] work #work' }),
        task({
          text: 'workDone',
          rawText: '- [x] workDone #work',
          status: 'done',
          statusSymbol: 'x',
        }),
        task({ text: 'personal', rawText: '- [ ] personal #personal' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', { type: 'tag', tag: '#work' });
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['work']);
    });

    it('{type:"group"} prefix mode matches rawText includes #prefix', () => {
      const group: TagGroup = {
        id: 'g1',
        name: 'Work',
        mode: 'prefix',
        prefix: 'work',
        color: '#f00',
      };
      const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
      const tasks = [
        task({ text: 'work', rawText: '- [ ] work #work' }),
        task({ text: 'workSub', rawText: '- [ ] workSub #work/deep' }),
        task({ text: 'other', rawText: '- [ ] other #personal' }),
        task({ text: 'done', rawText: '- [x] done #work', status: 'done', statusSymbol: 'x' }),
      ];
      const { panel, state } = makePanel(tasks, settings);
      state.set('selectedList', { type: 'group', groupId: 'g1' });
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text).sort((a, b) => a.localeCompare(b))).toEqual([
        'work',
        'workSub',
      ]);
    });

    it('{type:"group"} manual mode matches any tag in group.tags', () => {
      const group: TagGroup = {
        id: 'g1',
        name: 'Manual',
        mode: 'manual',
        tags: ['#a', '#b'],
      };
      const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
      const tasks = [
        task({ text: 'a', rawText: '- [ ] a #a' }),
        task({ text: 'b', rawText: '- [ ] b #b' }),
        task({ text: 'c', rawText: '- [ ] c #c' }),
      ];
      const { panel, state } = makePanel(tasks, settings);
      state.set('selectedList', { type: 'group', groupId: 'g1' });
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text).sort((a, b) => a.localeCompare(b))).toEqual(['a', 'b']);
    });

    it('{type:"group"} with missing groupId returns empty', () => {
      const tasks = [task({ text: 'a', rawText: '- [ ] a #a' })];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', { type: 'group', groupId: 'nope' });
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result).toHaveLength(0);
    });

    it('centerFilter filters by text (case-insensitive)', () => {
      const tasks = [
        task({ text: 'Buy Milk', rawText: '- [ ] Buy Milk' }),
        task({ text: 'Walk dog', rawText: '- [ ] Walk dog' }),
      ];
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        inbox: { mode: 'untagged', tag: '', removeTagOnAssign: false },
      };
      const { panel, state } = makePanel(tasks, settings);
      state.set('selectedList', 'inbox');
      state.set('centerFilter', 'milk');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['Buy Milk']);
    });

    it('centerFilter filters by rawText', () => {
      const tasks = [
        task({ text: 'task', rawText: '- [ ] task #urgent-marker' }),
        task({ text: 'task2', rawText: '- [ ] task2 #other' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'inbox');
      state.set('centerFilter', 'urgent-marker');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      // CURRENT BEHAVIOR: inbox=untagged mode excludes tagged tasks before filter,
      // so the #urgent-marker task is removed by getInboxTasks; centerFilter then
      // has nothing to match. Use tag selection to keep tagged tasks.
      // This test documents the inbox pre-filter interaction.
      expect(result).toHaveLength(0);
    });

    it('centerFilter filters by rawText on tag selection', () => {
      const tasks = [
        task({ text: 'same', rawText: '- [ ] same #work urgent-marker' }),
        task({ text: 'same', rawText: '- [ ] same #work other' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', { type: 'tag', tag: '#work' });
      state.set('centerFilter', 'urgent-marker');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result).toHaveLength(1);
      expect(result[0]?.rawText).toContain('urgent-marker');
    });

    it('centerFilter empty returns all (no filtering)', () => {
      const tasks = [
        task({ text: 'a', rawText: '- [ ] a' }),
        task({ text: 'b', rawText: '- [ ] b' }),
      ];
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        inbox: { mode: 'untagged', tag: '', removeTagOnAssign: false },
      };
      const { panel, state } = makePanel(tasks, settings);
      state.set('selectedList', 'inbox');
      state.set('centerFilter', '');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result).toHaveLength(2);
    });
  });

  describe('getTitle', () => {
    it('inbox → "Inbox"', () => {
      const { panel, state } = makePanel([]);
      state.set('selectedList', 'inbox');
      expect(call<string>(panel, 'getTitle')).toBe('Inbox');
    });

    it('today → "Today"', () => {
      const { panel, state } = makePanel([]);
      state.set('selectedList', 'today');
      expect(call<string>(panel, 'getTitle')).toBe('Today');
    });

    it('upcoming → "Upcoming"', () => {
      const { panel, state } = makePanel([]);
      state.set('selectedList', 'upcoming');
      expect(call<string>(panel, 'getTitle')).toBe('Upcoming');
    });

    it('{type:"tag"} → the tag string', () => {
      const { panel, state } = makePanel([]);
      state.set('selectedList', { type: 'tag', tag: '#work' });
      expect(call<string>(panel, 'getTitle')).toBe('#work');
    });

    it('{type:"group"} → group.name', () => {
      const group: TagGroup = { id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' };
      const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
      const { panel, state } = makePanel([], settings);
      state.set('selectedList', { type: 'group', groupId: 'g1' });
      expect(call<string>(panel, 'getTitle')).toBe('Work');
    });

    it('{type:"group"} with missing group → "Group"', () => {
      const { panel, state } = makePanel([]);
      state.set('selectedList', { type: 'group', groupId: 'nope' });
      expect(call<string>(panel, 'getTitle')).toBe('Group');
    });

    it('unknown selection → "Tasks"', () => {
      const { panel, state } = makePanel([]);
      state.set('selectedList', 'unknown' as unknown as 'inbox');
      expect(call<string>(panel, 'getTitle')).toBe('Tasks');
    });
  });

  describe('formatDate', () => {
    fixedToday('2026-06-25');

    it('today → "Today"', () => {
      const { panel } = makePanel([]);
      expect(call<string>(panel, 'formatDate', '2026-06-25')).toBe('Today');
    });

    it('tomorrow → "Tomorrow"', () => {
      const { panel } = makePanel([]);
      expect(call<string>(panel, 'formatDate', '2026-06-26')).toBe('Tomorrow');
    });

    it('within ±7 days → "ddd D MMM" format', () => {
      const { panel } = makePanel([]);
      // 2026-06-28 is +3 days → within range
      const result = call<string>(panel, 'formatDate', '2026-06-28');
      // moment formats: e.g. "Sun 28 Jun"
      expect(result).toMatch(/^[A-Z][a-z]{2} 28 Jun$/);
    });

    it('beyond 7 days → "D MMM" format (no weekday)', () => {
      const { panel } = makePanel([]);
      // 2026-07-25 is +30 days → outside ±7
      const result = call<string>(panel, 'formatDate', '2026-07-25');
      expect(result).toBe('25 Jul');
    });
  });

  describe('getDateClass', () => {
    fixedToday('2026-06-25');

    it('d < today → "is-overdue"', () => {
      const { panel } = makePanel([]);
      expect(call<string>(panel, 'getDateClass', '2026-06-20')).toBe('is-overdue');
    });

    it('d === today → "is-today"', () => {
      const { panel } = makePanel([]);
      expect(call<string>(panel, 'getDateClass', '2026-06-25')).toBe('is-today');
    });

    it('d === tomorrow → "is-tomorrow"', () => {
      const { panel } = makePanel([]);
      expect(call<string>(panel, 'getDateClass', '2026-06-26')).toBe('is-tomorrow');
    });

    it('d === dayAfterTomorrow → "is-soon"', () => {
      const { panel } = makePanel([]);
      expect(call<string>(panel, 'getDateClass', '2026-06-27')).toBe('is-soon');
    });

    it('other future date → ""', () => {
      const { panel } = makePanel([]);
      expect(call<string>(panel, 'getDateClass', '2026-07-10')).toBe('');
    });
  });

  describe('getListViewDefaults', () => {
    it('today list uses date grouping', () => {
      expect(getListViewDefaults('today').groupBy).toBe('date');
    });

    it('upcoming list uses date grouping', () => {
      expect(getListViewDefaults('upcoming').groupBy).toBe('date');
    });

    it('inbox list uses no grouping', () => {
      expect(getListViewDefaults('inbox').groupBy).toBe('none');
    });

    it('tag list uses no grouping', () => {
      expect(getListViewDefaults('tag:#work').groupBy).toBe('none');
    });

    it('all lists default to active show and date sort ascending', () => {
      for (const key of ['today', 'upcoming', 'inbox', 'tag:#work']) {
        const d = getListViewDefaults(key);
        expect(d.statusGroups).toEqual(['todo', 'in-progress']);
        expect(d.sortBy.field).toBe('date');
        expect(d.sortBy.dir).toBe('asc');
        expect(d.filters).toHaveLength(0);
      }
    });
  });

  describe('per-list state management', () => {
    it('loads default state for today list on mount', () => {
      const { state, panel } = makePanel([]);
      const container = document.createElement('div');
      panel.mount(container);
      const vs = state.get('centerListViewState');
      expect(vs.groupBy).toBe('date');
      expect(vs.statusGroups).toEqual(['todo', 'in-progress']);
    });

    it('switches to inbox defaults when selectedList changes to inbox', () => {
      const { state, panel } = makePanel([]);
      const container = document.createElement('div');
      panel.mount(container);
      state.set('selectedList', 'inbox');
      const vs = state.get('centerListViewState');
      expect(vs.groupBy).toBe('none');
    });
  });

  describe('getTagColor', () => {
    it('prefix mode: exact match returns group.color', () => {
      const group: TagGroup = {
        id: 'g1',
        name: 'Work',
        mode: 'prefix',
        prefix: 'work',
        color: '#ff0000',
      };
      const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
      const { panel } = makePanel([], settings);
      expect(call<string | undefined>(panel, 'getTagColor', '#work')).toBe('#ff0000');
    });

    it('prefix mode: slash-subtag matches (e.g. #work/deep)', () => {
      const group: TagGroup = {
        id: 'g1',
        name: 'Work',
        mode: 'prefix',
        prefix: 'work',
        color: '#ff0000',
      };
      const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
      const { panel } = makePanel([], settings);
      expect(call<string | undefined>(panel, 'getTagColor', '#work/deep')).toBe('#ff0000');
    });

    it('manual mode: matches tag with or without leading #', () => {
      const group: TagGroup = {
        id: 'g1',
        name: 'Manual',
        mode: 'manual',
        tags: ['#urgent', 'low'],
        color: '#00ff00',
      };
      const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
      const { panel } = makePanel([], settings);
      expect(call<string | undefined>(panel, 'getTagColor', '#urgent')).toBe('#00ff00');
      expect(call<string | undefined>(panel, 'getTagColor', '#low')).toBe('#00ff00');
    });

    it('no matching group → undefined', () => {
      const group: TagGroup = {
        id: 'g1',
        name: 'Work',
        mode: 'prefix',
        prefix: 'work',
        color: '#ff0000',
      };
      const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
      const { panel } = makePanel([], settings);
      expect(call<string | undefined>(panel, 'getTagColor', '#personal')).toBeUndefined();
    });

    it('empty tagGroups → undefined', () => {
      const { panel } = makePanel([]);
      expect(call<string | undefined>(panel, 'getTagColor', '#anything')).toBeUndefined();
    });

    it('group with no color property → undefined', () => {
      const group: TagGroup = {
        id: 'g1',
        name: 'Work',
        mode: 'prefix',
        prefix: 'work',
        // no color
      };
      const settings: CalendarSettings = { ...DEFAULT_SETTINGS, tagGroups: [group] };
      const { panel } = makePanel([], settings);
      expect(call<string | undefined>(panel, 'getTagColor', '#work')).toBeUndefined();
    });
  });
});

describe('getFilteredTasks respects the unified Show status filter (statusGroups)', () => {
  const untaggedSettings: CalendarSettings = {
    ...DEFAULT_SETTINGS,
    inbox: { mode: 'untagged', tag: '', removeTagOnAssign: false },
  };

  it('statusGroups=[todo,in-progress] (Active preset) excludes done tasks', () => {
    const { panel, state } = makePanel(
      [
        task({ text: 'open', rawText: '- [ ] open', status: 'open', statusSymbol: ' ' }),
        task({ text: 'done', rawText: '- [x] done', status: 'done', statusSymbol: 'x' }),
      ],
      untaggedSettings,
    );
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      statusGroups: ['todo', 'in-progress'],
      filters: [],
    });
    state.set('selectedList', 'inbox');
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks.every((t) => t.status !== 'done')).toBe(true);
  });

  it('statusGroups=[done,cancelled] returns only done/cancelled tasks', () => {
    const { panel, state } = makePanel(
      [
        task({ text: 'open', rawText: '- [ ] open', status: 'open', statusSymbol: ' ' }),
        task({ text: 'done', rawText: '- [x] done', status: 'done', statusSymbol: 'x' }),
      ],
      untaggedSettings,
    );
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      statusGroups: ['done', 'cancelled'],
      filters: [],
    });
    state.set('selectedList', 'inbox');
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks.every((t) => t.status === 'done')).toBe(true);
  });

  it('statusGroups=undefined (All preset) returns both', () => {
    const { panel, state } = makePanel(
      [
        task({ text: 'open', rawText: '- [ ] open', status: 'open', statusSymbol: ' ' }),
        task({ text: 'done', rawText: '- [x] done', status: 'done', statusSymbol: 'x' }),
      ],
      untaggedSettings,
    );
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      statusGroups: undefined,
      filters: [],
    });
    state.set('selectedList', 'inbox');
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks.length).toBe(2);
  });
});

describe('getFilteredTasks respects property filters', () => {
  it('tag filter keeps only tasks with matching tag', () => {
    const { panel, state } = makePanel([
      task({ rawText: '- [ ] work task #work', text: 'work task', status: 'open' }),
      task({ rawText: '- [ ] personal #personal', text: 'personal', status: 'open' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'tag', value: '#work' }],
    });
    state.set('selectedList', { type: 'tag', tag: '#work' });
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toBe('work task');
  });

  it('tag filter does not match partial tags (#work does not match #work/deep)', () => {
    const { panel, state } = makePanel([
      task({ rawText: '- [ ] task #work', text: 'exact', status: 'open' }),
      task({ rawText: '- [ ] task #work/deep', text: 'sub', status: 'open' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'tag', value: '#work' }],
    });
    // 'upcoming' with no dates → default branch returns all query snapshots
    state.set(
      'selectedList',
      'all-tasks' as unknown as import('../src/app/AppState').ListSelection,
    );
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toBe('exact');
  });

  it('file filter keeps only tasks from that file', () => {
    const { panel, state } = makePanel([
      task({ filePath: 'notes/a.md', text: 'from a', status: 'open' }),
      task({ filePath: 'notes/b.md', text: 'from b', status: 'open' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'file', filePath: 'notes/a.md' }],
    });
    state.set(
      'selectedList',
      'all-tasks' as unknown as import('../src/app/AppState').ListSelection,
    );
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toBe('from a');
  });

  it('time filter keeps only tasks with matching time', () => {
    const { panel, state } = makePanel([
      task({ text: 'morning', status: 'open', time: '09:00' }),
      task({ text: 'afternoon', status: 'open', time: '14:00' }),
      task({ text: 'no time', status: 'open' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'time', value: '09:00' }],
    });
    state.set(
      'selectedList',
      'all-tasks' as unknown as import('../src/app/AppState').ListSelection,
    );
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toBe('morning');
  });

  it('priority filter keeps only tasks with matching priority', () => {
    const { panel, state } = makePanel([
      task({ text: 'high', status: 'open', priority: 'B' }),
      task({ text: 'normal', status: 'open', priority: 'D' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'priority', value: 'B' }],
    });
    state.set(
      'selectedList',
      'all-tasks' as unknown as import('../src/app/AppState').ListSelection,
    );
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toBe('high');
  });

  it('status filter keeps only tasks with matching statusSymbol', () => {
    const { panel, state } = makePanel([
      task({ text: 'inProgress', status: 'in-progress', statusSymbol: '/' }),
      task({ text: 'todo', status: 'open', statusSymbol: ' ' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'status', value: '/' }],
    });
    state.set(
      'selectedList',
      'all-tasks' as unknown as import('../src/app/AppState').ListSelection,
    );
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toBe('inProgress');
  });

  it('date filter matches due, scheduled, or dailyNoteDate', () => {
    const { panel, state } = makePanel([
      task({ text: 'due', status: 'open', due: '2026-01-10' }),
      task({ text: 'sched', status: 'open', scheduled: '2026-01-10' }),
      task({ text: 'daily', status: 'open', dailyNoteDate: '2026-01-10' }),
      task({ text: 'other', status: 'open', due: '2026-01-11' }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'date', value: '2026-01-10' }],
    });
    state.set(
      'selectedList',
      'all-tasks' as unknown as import('../src/app/AppState').ListSelection,
    );
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.text)).toEqual(expect.arrayContaining(['due', 'sched', 'daily']));
  });

  it('multiple property filters are combined with AND', () => {
    const { panel, state } = makePanel([
      task({ rawText: '- [ ] t #work', text: 'work morning', status: 'open', time: '09:00' }),
      task({ rawText: '- [ ] t #work', text: 'work afternoon', status: 'open', time: '14:00' }),
      task({
        rawText: '- [ ] t #personal',
        text: 'personal morning',
        status: 'open',
        time: '09:00',
      }),
    ]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [
        { type: 'tag', value: '#work' },
        { type: 'time', value: '09:00' },
      ],
    });
    state.set(
      'selectedList',
      'all-tasks' as unknown as import('../src/app/AppState').ListSelection,
    );
    const tasks = call<Task[]>(panel, 'getFilteredTasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toBe('work morning');
  });
});

describe('addPropertyFilter', () => {
  it('adds a filter to the current list view state', () => {
    const { panel, state } = makePanel([]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [],
    });
    call(panel, 'addPropertyFilter', { type: 'tag', value: '#work' });
    expect(state.get('centerListViewState').filters).toHaveLength(1);
    expect(state.get('centerListViewState').filters[0]).toEqual({ type: 'tag', value: '#work' });
  });

  it('deduplicates tag filters by value', () => {
    const { panel, state } = makePanel([]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'tag', value: '#work' }],
    });
    call(panel, 'addPropertyFilter', { type: 'tag', value: '#work' });
    expect(state.get('centerListViewState').filters).toHaveLength(1);
  });

  it('deduplicates file filters by filePath', () => {
    const { panel, state } = makePanel([]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'file', filePath: 'a.md' }],
    });
    call(panel, 'addPropertyFilter', { type: 'file', filePath: 'a.md' });
    expect(state.get('centerListViewState').filters).toHaveLength(1);
  });

  it('deduplicates date filters by value', () => {
    const { panel, state } = makePanel([]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'date', value: '2026-01-10' }],
    });
    call(panel, 'addPropertyFilter', { type: 'date', value: '2026-01-10' });
    expect(state.get('centerListViewState').filters).toHaveLength(1);
  });

  it('deduplicates status filters by value', () => {
    const { panel, state } = makePanel([]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'status', value: '/' }],
    });
    call(panel, 'addPropertyFilter', { type: 'status', value: '/' });
    expect(state.get('centerListViewState').filters).toHaveLength(1);
  });

  it('allows different filter types with the same value', () => {
    const { panel, state } = makePanel([]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [{ type: 'tag', value: '#work' }],
    });
    call(panel, 'addPropertyFilter', { type: 'time', value: '#work' });
    expect(state.get('centerListViewState').filters).toHaveLength(2);
  });
});

describe('removePropertyFilter', () => {
  it('removes filter at given index', () => {
    const { panel, state } = makePanel([]);
    state.set('centerListViewState', {
      groupBy: 'none',
      sortBy: { field: 'date', dir: 'asc' },
      filters: [
        { type: 'tag', value: '#work' },
        { type: 'tag', value: '#personal' },
      ],
    });
    call(panel, 'removePropertyFilter', 0);
    const filters = state.get('centerListViewState').filters;
    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual({ type: 'tag', value: '#personal' });
  });
});

describe('filterChipLabel', () => {
  it('tag filter → tag value', () => {
    const { panel } = makePanel([]);
    expect(call<string>(panel, 'filterChipLabel', { type: 'tag', value: '#work' })).toBe('#work');
  });

  it('file filter → filename without extension', () => {
    const { panel } = makePanel([]);
    expect(
      call<string>(panel, 'filterChipLabel', { type: 'file', filePath: 'notes/Daily Note.md' }),
    ).toBe('📄 Daily Note');
  });

  it('time filter → clock emoji + time', () => {
    const { panel } = makePanel([]);
    expect(call<string>(panel, 'filterChipLabel', { type: 'time', value: '09:00' })).toBe(
      '⏰ 09:00',
    );
  });

  it('priority filter → emoji label', () => {
    const { panel } = makePanel([]);
    expect(call<string>(panel, 'filterChipLabel', { type: 'priority', value: 'B' })).toBe(
      '⏫ High',
    );
  });

  it('status filter → status name from registry', () => {
    const { panel } = makePanel([]);
    expect(call<string>(panel, 'filterChipLabel', { type: 'status', value: '/' })).toBe(
      'In progress',
    );
  });

  it('status filter → raw symbol fallback when unknown', () => {
    const { panel } = makePanel([]);
    expect(call<string>(panel, 'filterChipLabel', { type: 'status', value: '~' })).toBe('~');
  });
});
