import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { CalendarSettings } from '../src/settings/types';
import type { TaskStore } from '../src/store/TaskStore';
import { TagManager } from '../src/tags/TagManager';
import { freshContainer, makeStubStore, task, useRealMoment } from './helpers';

useRealMoment();

function makeCenter(
  tasks: Task[] = [],
  settings: Partial<CalendarSettings> = {},
  pinnedTags: string[] = [],
): { el: HTMLElement; state: AppState; tm: TagManager } {
  const state = new AppState();
  state.set('selectedList', 'inbox');
  const s: CalendarSettings = { ...DEFAULT_SETTINGS, ...settings, pinnedTags, archivedTags: [] };
  const save = vi.fn().mockResolvedValue(undefined);
  const tm = new TagManager(null as never, s, save);
  const store = makeStubStore(tasks) as unknown as TaskStore;
  const panel = new CenterPanel(state, store, null as never, s, tm);
  const el = freshContainer();
  panel.mount(el);
  return { el, state, tm };
}

describe('CenterPanel drag source', () => {
  it('task card has draggable attribute', () => {
    const tasks = [task({ rawText: '- [ ] t #task/inbox', status: 'open' })];
    const { el } = makeCenter(tasks);
    const card = el.querySelector('.tc-task-card') as HTMLElement;
    expect(card.getAttribute('draggable')).toBe('true');
  });

  it('dragstart sets state.draggingTask', () => {
    const t = task({ rawText: '- [ ] t #task/inbox', status: 'open' });
    const { el, state } = makeCenter([t]);
    const card = el.querySelector('.tc-task-card') as HTMLElement;
    const ev = new MouseEvent('dragstart', { bubbles: true });
    card.dispatchEvent(ev);
    expect(state.get('draggingTask')).toBeTruthy();
  });

  it('dragend clears state.draggingTask', () => {
    const t = task({ rawText: '- [ ] t #task/inbox', status: 'open' });
    const { el, state } = makeCenter([t]);
    const card = el.querySelector('.tc-task-card') as HTMLElement;
    const startEv = new MouseEvent('dragstart', { bubbles: true });
    card.dispatchEvent(startEv);
    const endEv = new MouseEvent('dragend', { bubbles: true });
    card.dispatchEvent(endEv);
    expect(state.get('draggingTask')).toBeNull();
  });
});

describe('CenterPanel tag→task drop target', () => {
  it('task card accepts drop when draggingTag is set', () => {
    const t = task({ rawText: '- [ ] t #task/inbox', status: 'open' });
    const { el, state, tm } = makeCenter([t]);
    const spy = vi.spyOn(tm, 'assignTagFromInbox').mockResolvedValue(undefined);
    const card = el.querySelector('.tc-task-card') as HTMLElement;

    state.set('draggingTag', '#task/next');
    const overEv = new MouseEvent('dragover', { bubbles: true });
    card.dispatchEvent(overEv);
    expect(card.classList.contains('tc-drop-target')).toBe(true);

    const dropEv = new MouseEvent('drop', { bubbles: true });
    card.dispatchEvent(dropEv);
    expect(card.classList.contains('tc-drop-target')).toBe(false);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ rawText: t.rawText }), '#task/next');
  });

  it('task card ignores dragover when draggingTag is null', () => {
    const t = task({ rawText: '- [ ] t #task/inbox', status: 'open' });
    const { el, state } = makeCenter([t]);
    state.set('draggingTag', null);
    const card = el.querySelector('.tc-task-card') as HTMLElement;
    const overEv = new MouseEvent('dragover', { bubbles: true });
    card.dispatchEvent(overEv);
    expect(card.classList.contains('tc-drop-target')).toBe(false);
  });
});

describe('CenterPanel tag chip replace on drop', () => {
  it('dropping draggingTag onto a chip calls replaceTagOnTask, not assignTagFromInbox', () => {
    const t = task({ rawText: '- [ ] t #work #task/inbox', status: 'open', line: 1 });
    const { el, state, tm } = makeCenter([t], {
      inbox: { mode: 'both', tag: '#task/inbox', showUntagged: false, removeTagOnAssign: true },
    });
    const replaceSpy = vi.spyOn(tm, 'replaceTagOnTask').mockResolvedValue(undefined);
    const assignSpy = vi.spyOn(tm, 'assignTagFromInbox').mockResolvedValue(undefined);

    state.set('draggingTag', '#task/next');
    const chip = el.querySelector('.tc-task-tag') as HTMLElement;
    expect(chip).not.toBeNull();

    chip.dispatchEvent(new MouseEvent('dragover', { bubbles: true }));
    expect(chip.classList.contains('tc-drop-target')).toBe(true);

    chip.dispatchEvent(new MouseEvent('drop', { bubbles: true }));
    expect(chip.classList.contains('tc-drop-target')).toBe(false);
    expect(replaceSpy).toHaveBeenCalledOnce();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('dragging a chip onto itself is a no-op', () => {
    const t = task({ rawText: '- [ ] t #work', status: 'open', line: 1 });
    const { el, state, tm } = makeCenter([t], {
      inbox: { mode: 'tag', tag: '#work', showUntagged: false, removeTagOnAssign: true },
    });
    const replaceSpy = vi.spyOn(tm, 'replaceTagOnTask').mockResolvedValue(undefined);

    state.set('draggingTag', '#work');
    const chip = el.querySelector('.tc-task-tag') as HTMLElement;
    chip.dispatchEvent(new MouseEvent('dragover', { bubbles: true }));
    expect(chip.classList.contains('tc-drop-target')).toBe(false);

    chip.dispatchEvent(new MouseEvent('drop', { bubbles: true }));
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

describe('CenterPanel inbox tasks (new inbox object)', () => {
  it('getInboxTasks tag mode returns tasks with inbox.tag', () => {
    const tasks = [
      task({ rawText: '- [ ] a #task/inbox', status: 'open' }),
      task({ rawText: '- [ ] b #work', status: 'open' }),
    ];
    const { el } = makeCenter(tasks, {
      inbox: { mode: 'tag', tag: '#task/inbox', showUntagged: false, removeTagOnAssign: true },
    });
    const cards = el.querySelectorAll('.tc-task-card');
    expect(cards).toHaveLength(1);
  });

  it('getInboxTasks untagged mode returns tasks without any tag', () => {
    const tasks = [
      task({ rawText: '- [ ] no tag', status: 'open' }),
      task({ rawText: '- [ ] has tag #work', status: 'open' }),
    ];
    const { el } = makeCenter(tasks, {
      inbox: { mode: 'untagged', tag: '#task/inbox', showUntagged: true, removeTagOnAssign: true },
    });
    const cards = el.querySelectorAll('.tc-task-card');
    expect(cards).toHaveLength(1);
  });
});
