import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/parser/types';
import { AppState } from '../src/app/AppState';

describe('AppState', () => {
  it('returns initial values', () => {
    const s = new AppState();
    expect(s.get('mode')).toBe('tasks');
    expect(s.get('selectedList')).toBe('today');
    expect(s.get('taskStack')).toEqual([]);
    expect(s.get('centerFilter')).toBe('');
    expect(s.get('searchQuery')).toBe('');
  });

  it('set updates value', () => {
    const s = new AppState();
    s.set('mode', 'calendar');
    expect(s.get('mode')).toBe('calendar');
  });

  it('on fires listener when value changes', () => {
    const s = new AppState();
    const cb = vi.fn();
    s.on('mode', cb);
    s.set('mode', 'search');
    expect(cb).toHaveBeenCalledWith('search', 'tasks');
  });

  it('on does not fire when value is unchanged', () => {
    const s = new AppState();
    const cb = vi.fn();
    s.on('mode', cb);
    s.set('mode', 'tasks'); // same as initial
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe stops listener', () => {
    const s = new AppState();
    const cb = vi.fn();
    const off = s.on('mode', cb);
    off();
    s.set('mode', 'calendar');
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple listeners on same key all fire', () => {
    const s = new AppState();
    const a = vi.fn();
    const b = vi.fn();
    s.on('centerFilter', a);
    s.on('centerFilter', b);
    s.set('centerFilter', 'hello');
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('listeners on different keys do not cross-fire', () => {
    const s = new AppState();
    const cb = vi.fn();
    s.on('searchQuery', cb);
    s.set('centerFilter', 'hello');
    expect(cb).not.toHaveBeenCalled();
  });

  // --- Edge cases (Phase 1 coverage) ---

  it('fires when taskStack is set to a new array equal in content (reference inequality)', () => {
    const s = new AppState();
    const cb = vi.fn();
    s.on('taskStack', cb);
    s.set('taskStack', []);
    // eslint-disable-next-line sonarjs/no-element-overwrite
    s.set('taskStack', []); // new ref, empty
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('does not fire when taskStack is set to the same reference', () => {
    const s = new AppState();
    const cb = vi.fn();
    const arr: never[] = [];
    s.on('taskStack', cb);
    s.set('taskStack', arr);
    // eslint-disable-next-line sonarjs/no-element-overwrite
    s.set('taskStack', arr); // same ref
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('round-trips a selectedList object variant { type: tag, tag }', () => {
    const s = new AppState();
    const sel = { type: 'tag', tag: 'work' } as const;
    s.set('selectedList', sel);
    expect(s.get('selectedList')).toEqual(sel);
  });

  it('round-trips a selectedList object variant { type: group, groupId }', () => {
    const s = new AppState();
    const sel = { type: 'group', groupId: 'g1' } as const;
    s.set('selectedList', sel);
    expect(s.get('selectedList')).toEqual(sel);
  });

  it('a throwing listener halts siblings and rethrows from set (CURRENT BEHAVIOR, follow-up FU-7)', () => {
    const s = new AppState();
    s.on('mode', () => {
      throw new Error('boom');
    });
    const sibling = vi.fn();
    s.on('mode', sibling);
    expect(() => s.set('mode', 'calendar')).toThrow('boom');
    expect(sibling).not.toHaveBeenCalled();
  });

  it('unsubscribe is idempotent (safe to call twice)', () => {
    const s = new AppState();
    const cb = vi.fn();
    const off = s.on('mode', cb);
    off();
    off();
    s.set('mode', 'search');
    expect(cb).not.toHaveBeenCalled();
  });

  it('re-adding a listener after unsubscribe works', () => {
    const s = new AppState();
    const cb = vi.fn();
    const off = s.on('mode', cb);
    off();
    s.on('mode', cb);
    s.set('mode', 'calendar');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('draggingTask initialises as null', () => {
    const s = new AppState();
    expect(s.get('draggingTask')).toBeNull();
  });

  it('draggingTask can be set to a task and back to null', () => {
    const s = new AppState();
    const t: Task = {
      filePath: 'a.md',
      line: 0,
      rawText: '- [ ] t',
      text: 't',
      status: 'open',
      priority: 'D',
    };
    s.set('draggingTask', t);
    expect(s.get('draggingTask')).toBe(t);
    s.set('draggingTask', null);
    expect(s.get('draggingTask')).toBeNull();
  });
});
