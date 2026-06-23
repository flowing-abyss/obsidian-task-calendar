import { describe, expect, it } from 'vitest';
import { parseSubItems } from '../src/parser/SubItemParser';

const FILE = 'test.md';

describe('parseSubItems', () => {
  it('returns empty result for task with no children', () => {
    const lines = ['- [ ] Task'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toEqual([]);
    expect(r.comments).toEqual([]);
    expect(r.description).toBe('');
    expect(r.subtaskRange).toBeUndefined();
  });

  it('parses open sub-task', () => {
    const lines = ['- [ ] Parent', '  - [ ] Child'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtasks[0]).toMatchObject({ text: 'Child', status: 'open', line: 1 });
    expect(r.subtaskRange).toEqual({ from: 1, to: 1 });
  });

  it('parses done sub-task', () => {
    const lines = ['- [ ] Parent', '  - [x] Done child'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks[0]).toMatchObject({ status: 'done' });
  });

  it('parses description line', () => {
    const lines = ['- [ ] Parent', '  - > My description'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.description).toBe('My description');
    expect(r.subtasks).toHaveLength(0);
    expect(r.comments).toHaveLength(0);
  });

  it('concatenates multiple description lines with newline', () => {
    const lines = ['- [ ] Parent', '  - > Line one', '  - > Line two'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.description).toBe('Line one\nLine two');
  });

  it('parses dated comment', () => {
    const lines = ['- [ ] Parent', '  - 2026-06-22: Some comment'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({ date: '2026-06-22', text: 'Some comment', line: 1 });
  });

  it('parses undated comment', () => {
    const lines = ['- [ ] Parent', '  - Just a comment'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.comments[0]).toMatchObject({ text: 'Just a comment', date: undefined });
  });

  it('stops at non-indented line', () => {
    const lines = ['- [ ] Parent', '  - [ ] Child', '- [ ] Sibling'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtaskRange).toEqual({ from: 1, to: 1 });
  });

  it('parses mixed children in order', () => {
    const lines = [
      '- [ ] Parent',
      '  - > Description',
      '  - [ ] Sub',
      '  - 2026-01-01: Comment',
      '  - Bare comment',
    ];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.description).toBe('Description');
    expect(r.subtasks).toHaveLength(1);
    expect(r.comments).toHaveLength(2);
    expect(r.subtaskRange).toEqual({ from: 1, to: 4 });
  });

  it('parses nested sub-tasks recursively', () => {
    const lines = ['- [ ] Root', '  - [ ] Child', '    - [ ] Grandchild'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtasks[0]?.subtasks).toHaveLength(1);
    expect(r.subtasks[0]?.subtasks?.[0]?.text).toBe('Grandchild');
  });

  it('sets filePath on subtasks', () => {
    const lines = ['- [ ] Parent', '  - [ ] Child'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks[0]?.filePath).toBe(FILE);
  });
});
