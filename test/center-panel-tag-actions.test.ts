import { Menu } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { CalendarSettings } from '../src/settings/types';
import type { TaskStore } from '../src/store/TaskStore';
import { TagManager } from '../src/tags/TagManager';
import type { TaskApplicationApi } from '../src/tasks';
import {
  freshContainer,
  makeCenterPanelForTest,
  makeStubStore,
  task,
  useRealMoment,
} from './helpers';

useRealMoment();

function makeCenter(
  tasks: Task[] = [],
  settings: Partial<CalendarSettings> = {},
  pinnedTags: string[] = [],
) {
  const state = new AppState();
  state.set('selectedList', 'inbox');
  const s: CalendarSettings = { ...DEFAULT_SETTINGS, ...settings, pinnedTags, archivedTags: [] };
  const save = vi.fn().mockResolvedValue(undefined);
  const tm = new TagManager(null as never, s, save);
  const store = makeStubStore(tasks) as unknown as TaskStore;
  const queries = (store as unknown as { taskQueries: TaskApplicationApi['queries'] }).taskQueries;
  const execute = vi.fn<TaskApplicationApi['execute']>().mockResolvedValue({
    type: 'io-error',
    cause: 'test',
    contentState: 'unchanged',
  });
  const panel = makeCenterPanelForTest(state, store, null as never, s, tm, undefined, null, null, {
    queries,
    execute,
  });
  const el = freshContainer();
  panel.mount(el);
  return { el, state, tm, execute };
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
  it('task card assigns a tag and removes the inbox tag in one API patch', () => {
    const t = task({ rawText: '- [ ] t #task/inbox', status: 'open' });
    const { el, state, execute } = makeCenter([t]);
    const card = el.querySelector('.tc-task-card') as HTMLElement;

    state.set('draggingTag', '#task/next');
    const overEv = new MouseEvent('dragover', { bubbles: true });
    card.dispatchEvent(overEv);
    expect(card.classList.contains('tc-drop-target')).toBe(true);

    const dropEv = new MouseEvent('drop', { bubbles: true });
    card.dispatchEvent(dropEv);
    expect(card.classList.contains('tc-drop-target')).toBe(false);
    expect(execute).toHaveBeenCalledWith({
      type: 'patch',
      target: {
        type: 'task',
        ref: expect.objectContaining({ filePath: t.filePath, line: t.line }),
      },
      patch: { tags: { add: ['#task/next'], remove: ['#task/inbox'] } },
    });
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

  it('ignores inline-code tag lookalikes and adds the real tag through the API', () => {
    const t = Object.assign(task({ rawText: '- [ ] t `#work` #task/inbox', status: 'open' }), {
      tags: ['#task/inbox'],
    });
    const { el, state, execute } = makeCenter([t]);
    const card = el.querySelector('.tc-task-card') as HTMLElement;

    expect(Array.from(el.querySelectorAll('.tc-task-tag')).map((chip) => chip.textContent)).toEqual(
      ['#task/inbox'],
    );
    state.set('draggingTag', '#work');
    card.dispatchEvent(new MouseEvent('drop', { bubbles: true }));

    expect(execute).toHaveBeenCalledWith({
      type: 'patch',
      target: {
        type: 'task',
        ref: expect.objectContaining({ filePath: t.filePath, line: t.line }),
      },
      patch: { tags: { add: ['#work'], remove: ['#task/inbox'] } },
    });
  });
});

describe('CenterPanel pinned-tag context menu', () => {
  it('offers add for an inline-only lookalike and sends an add patch', () => {
    const items: Array<{
      checked__: boolean | null;
      onClick__: ((event: MouseEvent) => unknown) | null;
      title__: string;
    }> = [];
    const addItem = vi.spyOn(Menu.prototype, 'addItem').mockImplementation(function (
      this: Menu,
      callback,
    ) {
      const item = {
        checked__: null as boolean | null,
        dom: document.createElement('div'),
        onClick__: null as ((event: MouseEvent) => unknown) | null,
        title__: '',
        onClick(value: (event: MouseEvent) => unknown) {
          this.onClick__ = value;
          return this;
        },
        setChecked(value: boolean | null) {
          this.checked__ = value;
          return this;
        },
        setDisabled() {
          return this;
        },
        setIcon() {
          return this;
        },
        setSection() {
          return this;
        },
        setSubmenu() {
          return new Menu();
        },
        setTitle(value: string) {
          this.title__ = value;
          return this;
        },
        setWarning() {
          return this;
        },
      };
      callback(item as never);
      items.push(item);
      return this;
    });
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementation(function (
      this: Menu,
    ) {
      return this;
    });
    const t = Object.assign(task({ rawText: '- [ ] t `#work` #task/inbox', status: 'open' }), {
      tags: ['#task/inbox'],
    });
    const { el, execute } = makeCenter([t], {}, ['#work']);

    (el.querySelector('.tc-task-card') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    const pinned = items.find((item) => item.title__ === '#work');
    expect(pinned?.checked__).toBe(false);

    pinned?.onClick__?.(new MouseEvent('click'));
    expect(execute).toHaveBeenCalledWith({
      type: 'patch',
      target: {
        type: 'task',
        ref: expect.objectContaining({ filePath: t.filePath, line: t.line }),
      },
      patch: { tags: { add: ['#work'], remove: [] } },
    });
    addItem.mockRestore();
    show.mockRestore();
  });
});

describe('CenterPanel tag chip replace on drop', () => {
  it('dropping draggingTag onto a chip sends one replacement patch', () => {
    const t = task({ rawText: '- [ ] t #work #task/inbox', status: 'open', line: 1 });
    const { el, state, execute } = makeCenter([t], {
      inbox: { mode: 'both', tag: '#task/inbox', removeTagOnAssign: true },
    });

    state.set('draggingTag', '#task/next');
    const chip = el.querySelector('.tc-task-tag') as HTMLElement;
    expect(chip).not.toBeNull();

    chip.dispatchEvent(new MouseEvent('dragover', { bubbles: true }));
    expect(chip.classList.contains('tc-drop-target')).toBe(true);

    chip.dispatchEvent(new MouseEvent('drop', { bubbles: true }));
    expect(chip.classList.contains('tc-drop-target')).toBe(false);
    expect(execute).toHaveBeenCalledWith({
      type: 'patch',
      target: {
        type: 'task',
        ref: expect.objectContaining({ filePath: t.filePath, line: t.line }),
      },
      patch: { tags: { add: ['#task/next'], remove: ['#work'] } },
    });
  });

  it('dragging a chip onto itself is a no-op', () => {
    const t = task({ rawText: '- [ ] t #work', status: 'open', line: 1 });
    const { el, state, execute } = makeCenter([t], {
      inbox: { mode: 'tag', tag: '#work', removeTagOnAssign: true },
    });

    state.set('draggingTag', '#work');
    const chip = el.querySelector('.tc-task-tag') as HTMLElement;
    chip.dispatchEvent(new MouseEvent('dragover', { bubbles: true }));
    expect(chip.classList.contains('tc-drop-target')).toBe(false);

    chip.dispatchEvent(new MouseEvent('drop', { bubbles: true }));
    expect(execute).not.toHaveBeenCalled();
  });

  it('renders one canonical chip when the same spelling also appears in inline code', () => {
    const t = Object.assign(
      task({ rawText: '- [ ] t `#work` #work #task/inbox', status: 'open' }),
      { tags: ['#work', '#task/inbox'] },
    );
    const { el } = makeCenter([t]);

    expect(Array.from(el.querySelectorAll('.tc-task-tag')).map((chip) => chip.textContent)).toEqual(
      ['#work', '#task/inbox'],
    );
  });
});

describe('CenterPanel inbox tasks (new inbox object)', () => {
  it('getInboxTasks tag mode returns tasks with inbox.tag', () => {
    const tasks = [
      task({ rawText: '- [ ] a #task/inbox', status: 'open' }),
      task({ rawText: '- [ ] b #work', status: 'open' }),
    ];
    const { el } = makeCenter(tasks, {
      inbox: { mode: 'tag', tag: '#task/inbox', removeTagOnAssign: true },
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
      inbox: { mode: 'untagged', tag: '#task/inbox', removeTagOnAssign: true },
    });
    const cards = el.querySelectorAll('.tc-task-card');
    expect(cards).toHaveLength(1);
  });
});
