// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { TaskStore } from '../src/store/TaskStore';
import { TagManager } from '../src/tags/TagManager';
import {
  freshContainer,
  makeCenterPanelForTest,
  makeStubStore,
  task,
  useRealMoment,
} from './helpers';

useRealMoment();

function makeCenter(tasks: Task[]): { el: HTMLElement; state: AppState; panel: CenterPanel } {
  const state = new AppState();
  state.set('selectedList', 'inbox');
  const save = vi.fn().mockResolvedValue(undefined);
  const tm = new TagManager(null as never, DEFAULT_SETTINGS, save);
  const store = makeStubStore(tasks) as unknown as TaskStore;
  const panel = makeCenterPanelForTest(state, store, null as never, DEFAULT_SETTINGS, tm);
  const el = freshContainer();
  panel.mount(el);
  return { el, state, panel };
}

describe('CenterPanel multi-selection', () => {
  const t1 = task({
    filePath: 'a.md',
    line: 0,
    rawText: '- [ ] Task 1 #task/inbox',
    status: 'open',
  });
  const t2 = task({
    filePath: 'a.md',
    line: 1,
    rawText: '- [ ] Task 2 #task/inbox',
    status: 'open',
  });
  const t3 = task({
    filePath: 'a.md',
    line: 2,
    rawText: '- [ ] Task 3 #task/inbox',
    status: 'open',
  });

  it('plain click selects only one card (no tc-multi-selected)', () => {
    const { el } = makeCenter([t1, t2]);
    const cards = el.querySelectorAll<HTMLElement>('.tc-task-card');
    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cards[0]!.classList.contains('tc-multi-selected')).toBe(false);
    expect(cards[1]!.classList.contains('tc-multi-selected')).toBe(false);
  });

  it('Ctrl+Click adds card to multi-selection', () => {
    const { el } = makeCenter([t1, t2]);
    const cards = el.querySelectorAll<HTMLElement>('.tc-task-card');
    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(cards[0]!.classList.contains('tc-multi-selected')).toBe(true);
  });

  it('Ctrl+Click two cards selects both', () => {
    const { el } = makeCenter([t1, t2]);
    const cards = el.querySelectorAll<HTMLElement>('.tc-task-card');
    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    cards[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(cards[0]!.classList.contains('tc-multi-selected')).toBe(true);
    expect(cards[1]!.classList.contains('tc-multi-selected')).toBe(true);
  });

  it('Ctrl+Click already-selected card deselects it', () => {
    const { el } = makeCenter([t1, t2]);
    const cards = el.querySelectorAll<HTMLElement>('.tc-task-card');
    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(cards[0]!.classList.contains('tc-multi-selected')).toBe(false);
  });

  it('shows selection badge when 2+ tasks selected', () => {
    const { el } = makeCenter([t1, t2]);
    const cards = el.querySelectorAll<HTMLElement>('.tc-task-card');
    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    cards[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    const badge = el.querySelector('.tc-selection-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('2');
  });

  it('badge is removed when selection drops below 2', () => {
    const { el } = makeCenter([t1, t2]);
    const cards = el.querySelectorAll<HTMLElement>('.tc-task-card');
    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    cards[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    // Deselect one
    cards[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(el.querySelector('.tc-selection-badge')).toBeNull();
  });

  it('Escape key clears selection', () => {
    const { el } = makeCenter([t1, t2]);
    const cards = el.querySelectorAll<HTMLElement>('.tc-task-card');
    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cards[0]!.classList.contains('tc-multi-selected')).toBe(false);
  });

  it('Shift+Click selects range', () => {
    const { el } = makeCenter([t1, t2, t3]);
    const cards = el.querySelectorAll<HTMLElement>('.tc-task-card');
    // Ctrl+Click first to set anchor
    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    // Shift+Click last
    cards[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(cards[0]!.classList.contains('tc-multi-selected')).toBe(true);
    expect(cards[1]!.classList.contains('tc-multi-selected')).toBe(true);
    expect(cards[2]!.classList.contains('tc-multi-selected')).toBe(true);
  });
});
