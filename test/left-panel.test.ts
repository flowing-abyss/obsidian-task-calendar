import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { LeftPanel } from '../src/panels/LeftPanel';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { CalendarSettings } from '../src/settings/types';
import type { TaskStore } from '../src/store/TaskStore';
import { TagManager } from '../src/tags/TagManager';
import { freshContainer, makeStubStore, task, useRealMoment } from './helpers';

useRealMoment();

function makePanel(
  tasks: Task[] = [],
  settings: Partial<CalendarSettings> = {},
  pinnedTags: string[] = [],
  archivedTags: string[] = [],
): { panel: LeftPanel; state: AppState; el: HTMLElement; tm: TagManager } {
  const state = new AppState();
  const store = makeStubStore(tasks) as TaskStore;
  const merged: CalendarSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    pinnedTags,
    archivedTags,
  };
  const save = vi.fn().mockResolvedValue(undefined);
  const tm = new TagManager(null as never, merged, save);
  const panel = new LeftPanel(state, store, merged, tm, null as never);
  const el = freshContainer();
  panel.mount(el);
  return { panel, state, el, tm };
}

function today(): string {
  return (window as unknown as { moment: (inp?: unknown) => { format(f: string): string } })
    .moment()
    .format('YYYY-MM-DD');
}

describe('LeftPanel smart lists', () => {
  it('renders Lists section header', () => {
    const { el } = makePanel();
    expect(el.querySelector('.tc-left-section-header')?.textContent).toBe('Lists');
  });

  it('renders Inbox/Today/Upcoming rows', () => {
    const { el } = makePanel();
    const labels = Array.from(el.querySelectorAll('.tc-left-item .tc-left-label')).map(
      (l) => l.textContent,
    );
    expect(labels).toContain('Inbox');
    expect(labels).toContain('Today');
    expect(labels).toContain('Upcoming');
  });

  it('countInbox tag mode counts open tasks with inboxTag', () => {
    const tasks = [
      task({ rawText: '- [ ] t #inbox', status: 'open' }),
      task({ rawText: '- [ ] t2 #inbox', status: 'open' }),
      task({ rawText: '- [x] done #inbox', status: 'done' }),
    ];
    const { el } = makePanel(tasks, {
      inbox: { mode: 'tag', tag: '#inbox', showUntagged: false, removeTagOnAssign: true },
    });
    const inboxRow = el.querySelector('.tc-left-item')!;
    expect(inboxRow.querySelector('.tc-left-count')?.textContent).toBe('2');
  });

  it('countInbox untagged mode counts open tasks with no #tag', () => {
    const tasks = [
      task({ rawText: '- [ ] no tag', status: 'open' }),
      task({ rawText: '- [ ] #work tagged', status: 'open' }),
      task({ rawText: '- [x] done no tag', status: 'done' }),
    ];
    const { el } = makePanel(tasks, {
      inbox: { mode: 'untagged', tag: '', showUntagged: true, removeTagOnAssign: true },
    });
    const inboxRow = el.querySelector('.tc-left-item')!;
    expect(inboxRow.querySelector('.tc-left-count')?.textContent).toBe('1');
  });

  it('countToday matches due/scheduled/dailyNoteDate === today', () => {
    const t = today();
    const tasks = [
      task({ due: t, status: 'open' }),
      task({ scheduled: t, status: 'open' }),
      task({ dailyNoteDate: t, status: 'open' }),
      task({ due: '2020-01-01', status: 'open' }),
      task({ due: t, status: 'done' }),
    ];
    const { el } = makePanel(tasks);
    const rows = el.querySelectorAll('.tc-left-item');
    const todayRow = rows[1]!;
    expect(todayRow.querySelector('.tc-left-count')?.textContent).toBe('3');
  });

  it('countUpcoming matches due ?? scheduled ?? dailyNoteDate > today', () => {
    const tasks = [
      task({ due: '2099-12-31', status: 'open' }),
      task({ scheduled: '2099-01-01', status: 'open' }),
      task({ dailyNoteDate: '2099-06-01', status: 'open' }),
      task({ due: '2020-01-01', status: 'open' }),
      task({ due: '2099-12-31', status: 'done' }),
    ];
    const { el } = makePanel(tasks);
    const rows = el.querySelectorAll('.tc-left-item');
    const upcomingRow = rows[2]!;
    expect(upcomingRow.querySelector('.tc-left-count')?.textContent).toBe('3');
  });

  it('count badge absent when count is 0', () => {
    const { el } = makePanel([], {
      inbox: { mode: 'tag', tag: '#inbox', showUntagged: false, removeTagOnAssign: true },
    });
    const inboxRow = el.querySelector('.tc-left-item')!;
    expect(inboxRow.querySelector('.tc-left-count')).toBeNull();
  });

  it('is-active class on currently-selected smart list', () => {
    const state = new AppState();
    state.set('selectedList', 'today');
    const store = makeStubStore([]) as TaskStore;
    const save = vi.fn().mockResolvedValue(undefined);
    const tm = new TagManager(null as never, DEFAULT_SETTINGS, save);
    const panel = new LeftPanel(state, store, DEFAULT_SETTINGS, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    const active = el.querySelector('.tc-left-item.is-active .tc-left-label');
    expect(active?.textContent).toBe('Today');
  });

  it('click Inbox sets selectedList and mode', () => {
    const { el, state } = makePanel();
    (el.querySelector('.tc-left-item') as HTMLElement).click();
    expect(state.get('selectedList')).toBe('inbox');
    expect(state.get('mode')).toBe('tasks');
  });

  it('click Today sets selectedList and mode', () => {
    const { el, state } = makePanel();
    (el.querySelectorAll('.tc-left-item')[1] as HTMLElement).click();
    expect(state.get('selectedList')).toBe('today');
    expect(state.get('mode')).toBe('tasks');
  });

  it('click Upcoming sets selectedList and mode', () => {
    const { el, state } = makePanel();
    (el.querySelectorAll('.tc-left-item')[2] as HTMLElement).click();
    expect(state.get('selectedList')).toBe('upcoming');
    expect(state.get('mode')).toBe('tasks');
  });
});

describe('LeftPanel tag groups (prefix mode)', () => {
  it('renders Tags section only when tagGroups non-empty', () => {
    const { el } = makePanel([], { tagGroups: [] });
    expect(el.querySelector('.tc-left-divider')).toBeNull();
    const { el: el2 } = makePanel([], {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    expect(el2.querySelector('.tc-left-divider')).not.toBeNull();
  });

  it('group header renders name', () => {
    const { el } = makePanel([], {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    expect(el.querySelector('.tc-tag-group-header .tc-left-label')?.textContent).toBe('Work');
  });

  it('group count includes root prefix and subtags (open tasks only)', () => {
    const tasks = [
      task({ rawText: '- [ ] #work task', status: 'open' }),
      task({ rawText: '- [ ] #work/dev task', status: 'open' }),
      task({ rawText: '- [x] #work done', status: 'done' }),
    ];
    const { el } = makePanel(tasks, {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    expect(el.querySelector('.tc-tag-group-header .tc-left-count')?.textContent).toBe('2');
  });

  it('group header is-active when selectedList is group', () => {
    const state = new AppState();
    state.set('selectedList', { type: 'group', groupId: 'g1' });
    const store = makeStubStore([]) as TaskStore;
    const save = vi.fn().mockResolvedValue(undefined);
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    };
    const tm = new TagManager(null as never, settings, save);
    const panel = new LeftPanel(state, store, settings, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    expect(el.querySelector('.tc-tag-group-header')?.classList.contains('is-active')).toBe(true);
  });

  it('click group header sets selectedList and mode', () => {
    const { el, state } = makePanel([], {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    (el.querySelector('.tc-tag-group-header') as HTMLElement).click();
    expect(state.get('selectedList')).toEqual({ type: 'group', groupId: 'g1' });
    expect(state.get('mode')).toBe('tasks');
  });

  it('chevron click expands collapsed group', () => {
    const { el } = makePanel([], {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    const chevron = el.querySelector('.tc-group-arrow') as HTMLElement;
    expect(el.querySelector('.tc-tag-group-children')).toBeNull();
    chevron.click();
    expect(el.querySelector('.tc-tag-group-children')).not.toBeNull();
  });

  it('chevron click collapses expanded group', () => {
    const state = new AppState();
    state.set('selectedList', { type: 'tag', tag: '#work/dev' });
    const store = makeStubStore([task({ rawText: '- [ ] #work/dev task' })]) as TaskStore;
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    };
    const save = vi.fn().mockResolvedValue(undefined);
    const tm = new TagManager(null as never, settings, save);
    const panel = new LeftPanel(state, store, settings, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    // auto-expanded due to active child
    expect(el.querySelector('.tc-tag-group-children')).not.toBeNull();
    (el.querySelector('.tc-group-arrow') as HTMLElement).click();
    expect(el.querySelector('.tc-tag-group-children')).toBeNull();
  });

  it('auto-expand when child tag is active (unless explicitly collapsed)', () => {
    const state = new AppState();
    state.set('selectedList', { type: 'tag', tag: '#work/dev' });
    const store = makeStubStore([task({ rawText: '- [ ] #work/dev task' })]) as TaskStore;
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    };
    const save = vi.fn().mockResolvedValue(undefined);
    const tm = new TagManager(null as never, settings, save);
    const panel = new LeftPanel(state, store, settings, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    expect(el.querySelector('.tc-tag-group-children')).not.toBeNull();
  });

  it('explicit collapse prevents auto-expand even with active child', () => {
    const state = new AppState();
    state.set('selectedList', { type: 'tag', tag: '#work/dev' });
    const store = makeStubStore([task({ rawText: '- [ ] #work/dev task' })]) as TaskStore;
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    };
    const save = vi.fn().mockResolvedValue(undefined);
    const tm = new TagManager(null as never, settings, save);
    const panel = new LeftPanel(state, store, settings, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    // Collapse explicitly
    (el.querySelector('.tc-group-arrow') as HTMLElement).click();
    // Re-render by triggering state change
    state.set('selectedList', { type: 'tag', tag: '#work/dev' });
    expect(el.querySelector('.tc-tag-group-children')).toBeNull();
  });

  it('expanded group renders child tags with label stripping', () => {
    const tasks = [task({ rawText: '- [ ] #work/dev task', status: 'open' })];
    const { el } = makePanel(tasks, {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    (el.querySelector('.tc-group-arrow') as HTMLElement).click();
    const childLabel = el.querySelector('.tc-tag-child .tc-left-label')?.textContent;
    expect(childLabel).toBe('dev');
  });

  it('child tag count badge shows open task count', () => {
    const tasks = [
      task({ rawText: '- [ ] #work/dev a', status: 'open' }),
      task({ rawText: '- [ ] #work/dev b', status: 'open' }),
      task({ rawText: '- [x] #work/dev done', status: 'done' }),
    ];
    const { el } = makePanel(tasks, {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    (el.querySelector('.tc-group-arrow') as HTMLElement).click();
    expect(el.querySelector('.tc-tag-child .tc-left-count')?.textContent).toBe('2');
  });

  it('child tag is-active when selectedList is that tag', () => {
    const state = new AppState();
    state.set('selectedList', { type: 'tag', tag: '#work/dev' });
    const store = makeStubStore([task({ rawText: '- [ ] #work/dev task' })]) as TaskStore;
    const settings: CalendarSettings = {
      ...DEFAULT_SETTINGS,
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    };
    const save = vi.fn().mockResolvedValue(undefined);
    const tm = new TagManager(null as never, settings, save);
    const panel = new LeftPanel(state, store, settings, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    expect(el.querySelector('.tc-tag-child.is-active .tc-left-label')?.textContent).toBe('dev');
  });

  it('click child tag sets selectedList and mode with stopPropagation', () => {
    const { el, state } = makePanel([task({ rawText: '- [ ] #work/dev task' })], {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    (el.querySelector('.tc-group-arrow') as HTMLElement).click();
    const child = el.querySelector('.tc-tag-child') as HTMLElement;
    child.click();
    expect(state.get('selectedList')).toEqual({ type: 'tag', tag: '#work/dev' });
    expect(state.get('mode')).toBe('tasks');
  });

  it('resolveGroupTags prefix mode: finds subtags, excludes root, sorted', () => {
    const tasks = [
      task({ rawText: '- [ ] #work/dev and #work/alpha task' }),
      task({ rawText: '- [ ] #work task' }),
    ];
    const { el } = makePanel(tasks, {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    (el.querySelector('.tc-group-arrow') as HTMLElement).click();
    const childLabels = Array.from(el.querySelectorAll('.tc-tag-child .tc-left-label')).map(
      (l) => l.textContent,
    );
    // sorted localeCompare: #work/alpha < #work/dev
    expect(childLabels).toEqual(['alpha', 'dev']);
  });

  it('resolveGroupTags prefix mode: #work does not match #workplace', () => {
    const tasks = [task({ rawText: '- [ ] #workplace task' })];
    const { el } = makePanel(tasks, {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    (el.querySelector('.tc-group-arrow') as HTMLElement).click();
    expect(el.querySelectorAll('.tc-tag-child')).toHaveLength(0);
  });

  it('group count over-counts #workplace as #work (CURRENT BEHAVIOR: substring match, follow-up: FU-21)', () => {
    const tasks = [task({ rawText: '- [ ] #workplace task', status: 'open' })];
    const { el } = makePanel(tasks, {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work' }],
    });
    // FU-21: group count uses rawText.includes('#work'), which matches '#workplace' too
    expect(el.querySelector('.tc-tag-group-header .tc-left-count')?.textContent).toBe('1');
  });

  it('group color renders as dot', () => {
    const { el } = makePanel([], {
      tagGroups: [{ id: 'g1', name: 'Work', mode: 'prefix', prefix: 'work', color: '#ff0000' }],
    });
    const dot = el.querySelector('.tc-group-dot');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).style.background).toBe('rgb(255, 0, 0)');
  });
});

describe('LeftPanel tag groups (manual mode)', () => {
  it('manual group renders children from group.tags', () => {
    const { el } = makePanel([], {
      tagGroups: [{ id: 'g1', name: 'Manual', mode: 'manual', tags: ['#foo', '#bar'] }],
    });
    (el.querySelector('.tc-group-arrow') as HTMLElement).click();
    const labels = Array.from(el.querySelectorAll('.tc-tag-child .tc-left-label')).map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(['#foo', '#bar']);
  });

  it('manual group count counts open tasks matching any tag in group.tags', () => {
    const tasks = [
      task({ rawText: '- [ ] #foo task', status: 'open' }),
      task({ rawText: '- [ ] #bar task', status: 'open' }),
      task({ rawText: '- [x] #foo done', status: 'done' }),
    ];
    const { el } = makePanel(tasks, {
      tagGroups: [{ id: 'g1', name: 'Manual', mode: 'manual', tags: ['#foo', '#bar'] }],
    });
    expect(el.querySelector('.tc-tag-group-header .tc-left-count')?.textContent).toBe('2');
  });

  it('manual group no prefix stripping (labels are full tags)', () => {
    const { el } = makePanel([], {
      tagGroups: [{ id: 'g1', name: 'Manual', mode: 'manual', tags: ['#work/dev'] }],
    });
    (el.querySelector('.tc-group-arrow') as HTMLElement).click();
    expect(el.querySelector('.tc-tag-child .tc-left-label')?.textContent).toBe('#work/dev');
  });
});

describe('LeftPanel lifecycle', () => {
  it('mount subscribes to selectedList changes', () => {
    const state = new AppState();
    const store = makeStubStore([]) as TaskStore;
    const save = vi.fn().mockResolvedValue(undefined);
    const tm = new TagManager(null as never, DEFAULT_SETTINGS, save);
    const panel = new LeftPanel(state, store, DEFAULT_SETTINGS, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    state.set('selectedList', 'inbox');
    // re-rendered: inbox should be active
    expect(el.querySelector('.tc-left-item.is-active .tc-left-label')?.textContent).toBe('Inbox');
  });

  it('mount subscribes to mode changes', () => {
    const state = new AppState();
    const store = makeStubStore([]) as TaskStore;
    const save = vi.fn().mockResolvedValue(undefined);
    const tm = new TagManager(null as never, DEFAULT_SETTINGS, save);
    const panel = new LeftPanel(state, store, DEFAULT_SETTINGS, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    expect(el.children.length).toBeGreaterThan(0);
    state.set('mode', 'search');
    // search mode: render returns early, el emptied
    expect(el.children).toHaveLength(0);
  });

  it('refresh re-renders', () => {
    const { el, panel } = makePanel([]);
    (el.querySelector('.tc-left-item') as HTMLElement).click();
    panel.refresh();
    // still has content after refresh
    expect(el.querySelector('.tc-left-section-header')).not.toBeNull();
  });

  it('destroy removes listeners and empties el', () => {
    const state = new AppState();
    const store = makeStubStore([]) as TaskStore;
    const save = vi.fn().mockResolvedValue(undefined);
    const tm = new TagManager(null as never, DEFAULT_SETTINGS, save);
    const panel = new LeftPanel(state, store, DEFAULT_SETTINGS, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    panel.destroy();
    expect(el.children).toHaveLength(0);
    state.set('mode', 'search');
    // no re-render after destroy
    expect(el.children).toHaveLength(0);
  });

  it('search mode hides panel (no children)', () => {
    const state = new AppState();
    state.set('mode', 'search');
    const store = makeStubStore([]) as TaskStore;
    const save = vi.fn().mockResolvedValue(undefined);
    const tm = new TagManager(null as never, DEFAULT_SETTINGS, save);
    const panel = new LeftPanel(state, store, DEFAULT_SETTINGS, tm, null as never);
    const el = freshContainer();
    panel.mount(el);
    expect(el.children).toHaveLength(0);
  });
});

describe('LeftPanel Pinned section', () => {
  it('renders Pinned section when pinnedTags is non-empty', () => {
    const { el } = makePanel([], {}, ['#task/next']);
    const headers = Array.from(el.querySelectorAll('.tc-left-section-header')).map(
      (h) => h.textContent,
    );
    expect(headers).toContain('Pinned');
  });

  it('does not render Pinned section when pinnedTags is empty', () => {
    const { el } = makePanel();
    const headers = Array.from(el.querySelectorAll('.tc-left-section-header')).map(
      (h) => h.textContent,
    );
    expect(headers).not.toContain('Pinned');
  });

  it('shows full tag name in Pinned section', () => {
    const { el } = makePanel([], {}, ['#task/next_action']);
    const items = el.querySelectorAll('.tc-pinned-tag .tc-left-label');
    expect(items[0]?.textContent).toBe('#task/next_action');
  });

  it('clicking pinned tag sets selectedList to that tag', () => {
    const { el, state } = makePanel([], {}, ['#task/next']);
    const item = el.querySelector('.tc-pinned-tag') as HTMLElement;
    item.click();
    const sel = state.get('selectedList');
    expect(typeof sel === 'object' && sel.type === 'tag' && sel.tag).toBe('#task/next');
  });
});

describe('LeftPanel archived tags are hidden', () => {
  it('does not render archived tags in Tags section', () => {
    const tasks = [task({ rawText: '- [ ] t #work/dev', status: 'open' })];
    const settings: Partial<CalendarSettings> = {
      tagGroups: [{ id: 'g1', name: 'work', mode: 'prefix', prefix: 'work' }],
    };
    const { el } = makePanel(tasks, settings, [], ['#work/dev']);
    const childLabels = Array.from(el.querySelectorAll('.tc-tag-child .tc-left-label')).map(
      (l) => l.textContent,
    );
    expect(childLabels).not.toContain('dev');
  });
});

describe('LeftPanel inbox logic (new inbox object)', () => {
  it('countInbox tag mode uses inbox.tag', () => {
    const tasks = [
      task({ rawText: '- [ ] t #task/inbox', status: 'open' }),
      task({ rawText: '- [ ] t2 #other', status: 'open' }),
    ];
    const { el } = makePanel(tasks, {
      inbox: { mode: 'tag', tag: '#task/inbox', showUntagged: false, removeTagOnAssign: true },
    });
    const inboxCount = el.querySelector('.tc-left-item .tc-left-count')?.textContent;
    expect(inboxCount).toBe('1');
  });

  it('countInbox untagged mode counts tasks without any tag', () => {
    const tasks = [
      task({ rawText: '- [ ] no tag', status: 'open' }),
      task({ rawText: '- [ ] has tag #work', status: 'open' }),
    ];
    const { el } = makePanel(tasks, {
      inbox: { mode: 'untagged', tag: '#task/inbox', showUntagged: true, removeTagOnAssign: true },
    });
    const inboxCount = el.querySelector('.tc-left-item .tc-left-count')?.textContent;
    expect(inboxCount).toBe('1');
  });

  it('countInbox both mode counts union', () => {
    const tasks = [
      task({ rawText: '- [ ] no tag', status: 'open', line: 0 }),
      task({ rawText: '- [ ] has inbox #task/inbox', status: 'open', line: 1 }),
      task({ rawText: '- [ ] has other #work', status: 'open', line: 2 }),
    ];
    const { el } = makePanel(tasks, {
      inbox: { mode: 'both', tag: '#task/inbox', showUntagged: true, removeTagOnAssign: true },
    });
    const inboxCount = el.querySelector('.tc-left-item .tc-left-count')?.textContent;
    expect(inboxCount).toBe('2');
  });
});

describe('LeftPanel drop zones', () => {
  it('adds tc-drop-target class on dragover when draggingTask is set', () => {
    const t = task({ rawText: '- [ ] t', status: 'open' });
    const { el, state } = makePanel([], {}, ['#task/next']);
    state.set('draggingTask', t);
    const pinned = el.querySelector('.tc-pinned-tag') as HTMLElement;
    const ev = new MouseEvent('dragover', { bubbles: true, cancelable: true });
    pinned.dispatchEvent(ev);
    expect(pinned.classList.contains('tc-drop-target')).toBe(true);
  });

  it('does not add tc-drop-target when no draggingTask', () => {
    const { el } = makePanel([], {}, ['#task/next']);
    const pinned = el.querySelector('.tc-pinned-tag') as HTMLElement;
    const ev = new MouseEvent('dragover', { bubbles: true, cancelable: true });
    pinned.dispatchEvent(ev);
    expect(pinned.classList.contains('tc-drop-target')).toBe(false);
  });
});
