import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { CalendarSettings, TagGroup } from '../src/settings/types';
import type { TaskStore } from '../src/store/TaskStore';
import { fixedToday, makeStubStore, task, useRealMoment } from './helpers';

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
  const panel = new CenterPanel(state, store, app, settings, null as never);
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
        inbox: { mode: 'untagged', tag: '', showUntagged: true, removeTagOnAssign: false },
      };
      const { panel, state } = makePanel(tasks, settings);
      state.set('selectedList', 'inbox');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['no tag']);
    });

    it('today includes tasks due/scheduled/dailyNoteDate today', () => {
      const tasks = [
        task({ text: 'dueToday', rawText: '- [ ] dueToday', due: '2026-06-25' }),
        task({ text: 'schedToday', rawText: '- [ ] schedToday', scheduled: '2026-06-25' }),
        task({ text: 'dnToday', rawText: '- [ ] dnToday', dailyNoteDate: '2026-06-25' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'today');
      fixedToday('2026-06-25');
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
        task({ text: 'done', rawText: '- [x] done', status: 'done', due: '2026-06-25' }),
        task({ text: 'open', rawText: '- [ ] open', due: '2026-06-25' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'today');
      fixedToday('2026-06-25');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['open']);
    });

    it('today excludes future tasks (due > today, not overdue)', () => {
      const tasks = [task({ text: 'future', rawText: '- [ ] future', due: '2026-06-30' })];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'today');
      fixedToday('2026-06-25');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result).toHaveLength(0);
    });

    it('upcoming returns open tasks with date > today, sorted', () => {
      const tasks = [
        task({ text: 'far', rawText: '- [ ] far', due: '2026-07-10' }),
        task({ text: 'near', rawText: '- [ ] near', due: '2026-06-27' }),
        task({ text: 'past', rawText: '- [ ] past', due: '2026-06-20' }),
        task({ text: 'done', rawText: '- [x] done', status: 'done', due: '2026-06-27' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'upcoming');
      fixedToday('2026-06-25');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['near', 'far']);
    });

    it('upcoming uses due ?? scheduled ?? dailyNoteDate', () => {
      const tasks = [
        task({ text: 'sched', rawText: '- [ ] sched', scheduled: '2026-06-28' }),
        task({ text: 'dn', rawText: '- [ ] dn', dailyNoteDate: '2026-06-29' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'upcoming');
      fixedToday('2026-06-25');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['sched', 'dn']);
    });

    it('default string selection returns all open tasks', () => {
      // 'today' is a known string; use a non-matching string by casting
      const tasks = [
        task({ text: 'open', rawText: '- [ ] open' }),
        task({ text: 'done', rawText: '- [x] done', status: 'done' }),
      ];
      const { panel, state } = makePanel(tasks);
      state.set('selectedList', 'unknown-list' as unknown as 'inbox');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result.map((t) => t.text)).toEqual(['open']);
    });

    it('{type:"tag"} filters via store.getTasks({tag}) and status open', () => {
      const tasks = [
        task({ text: 'work', rawText: '- [ ] work #work' }),
        task({ text: 'workDone', rawText: '- [x] workDone #work', status: 'done' }),
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
        task({ text: 'done', rawText: '- [x] done #work', status: 'done' }),
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
        inbox: { mode: 'untagged', tag: '', showUntagged: true, removeTagOnAssign: false },
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
        inbox: { mode: 'untagged', tag: '', showUntagged: true, removeTagOnAssign: false },
      };
      const { panel, state } = makePanel(tasks, settings);
      state.set('selectedList', 'inbox');
      state.set('centerFilter', '');
      const result = call<Task[]>(panel, 'getFilteredTasks');
      expect(result).toHaveLength(2);
    });
  });

  describe('getInboxTasks', () => {
    it('tag mode: includes tasks whose rawText contains inboxTag', () => {
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        inbox: { mode: 'tag', tag: '#inbox', showUntagged: false, removeTagOnAssign: true },
      };
      const tasks = [
        task({ text: 'inbox', rawText: '- [ ] inbox #inbox' }),
        task({ text: 'plain', rawText: '- [ ] plain' }),
        task({ text: 'other', rawText: '- [ ] other #work' }),
      ];
      const { panel } = makePanel(tasks, settings);
      const result = call<Task[]>(panel, 'getInboxTasks');
      expect(result.map((t) => t.text)).toEqual(['inbox']);
    });

    it('tag mode: excludes done tasks', () => {
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        inbox: { mode: 'tag', tag: '#inbox', showUntagged: false, removeTagOnAssign: true },
      };
      const tasks = [
        task({ text: 'open', rawText: '- [ ] open #inbox' }),
        task({ text: 'done', rawText: '- [x] done #inbox', status: 'done' }),
      ];
      const { panel } = makePanel(tasks, settings);
      const result = call<Task[]>(panel, 'getInboxTasks');
      expect(result.map((t) => t.text)).toEqual(['open']);
    });

    it('untagged mode: includes tasks with no hashtags', () => {
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        inbox: { mode: 'untagged', tag: '', showUntagged: true, removeTagOnAssign: false },
      };
      const tasks = [
        task({ text: 'plain', rawText: '- [ ] plain' }),
        task({ text: 'tagged', rawText: '- [ ] tagged #work' }),
      ];
      const { panel } = makePanel(tasks, settings);
      const result = call<Task[]>(panel, 'getInboxTasks');
      expect(result.map((t) => t.text)).toEqual(['plain']);
    });

    it('untagged mode: excludes done tasks', () => {
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        inbox: { mode: 'untagged', tag: '', showUntagged: true, removeTagOnAssign: false },
      };
      const tasks = [
        task({ text: 'open', rawText: '- [ ] open' }),
        task({ text: 'done', rawText: '- [x] done', status: 'done' }),
      ];
      const { panel } = makePanel(tasks, settings);
      const result = call<Task[]>(panel, 'getInboxTasks');
      expect(result.map((t) => t.text)).toEqual(['open']);
    });

    it('tag mode + showUntagged=true: includes both tagged and untagged open tasks', () => {
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        inbox: { mode: 'tag', tag: '#task/inbox', showUntagged: true, removeTagOnAssign: true },
      };
      const tasks = [
        task({ text: 'with-inbox', rawText: '- [ ] with-inbox #task/inbox', line: 1 }),
        task({ text: 'no-tag', rawText: '- [ ] no-tag', line: 2 }),
        task({ text: 'other-tag', rawText: '- [ ] other-tag #work', line: 3 }),
      ];
      const { panel } = makePanel(tasks, settings);
      const result = call<Task[]>(panel, 'getInboxTasks');
      expect(result.map((t) => t.text).sort()).toEqual(['no-tag', 'with-inbox']);
    });

    it('tag mode with empty inboxTag matches all tasks (CURRENT BEHAVIOR: rawText.includes("") is always true, follow-up: FU-22)', () => {
      const settings: CalendarSettings = {
        ...DEFAULT_SETTINGS,
        inbox: { mode: 'tag', tag: '', showUntagged: false, removeTagOnAssign: true },
      };
      const tasks = [
        task({ text: 'plain', rawText: '- [ ] plain' }),
        task({ text: 'tagged', rawText: '- [ ] tagged #work' }),
        task({ text: 'done', rawText: '- [x] done', status: 'done' }),
      ];
      const { panel } = makePanel(tasks, settings);
      const result = call<Task[]>(panel, 'getInboxTasks');
      // FU-22: empty inboxTag → rawText.includes('') returns true for all open tasks
      expect(result.map((t) => t.text)).toEqual(['plain', 'tagged']);
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
