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

  it('parses 3 levels of nesting (great-grandchild)', () => {
    const lines = [
      '- [ ] Root',
      '  - [ ] Child',
      '    - [ ] Grandchild',
      '      - [ ] GreatGrandchild',
    ];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(1);
    const child = r.subtasks[0];
    expect(child?.subtasks).toHaveLength(1);
    const grand = child?.subtasks?.[0];
    expect(grand?.subtasks).toHaveLength(1);
    expect(grand?.subtasks?.[0]?.text).toBe('GreatGrandchild');
  });

  it('subtaskRange covers all descendants', () => {
    const lines = ['- [ ] Root', '  - [ ] Child', '    - [ ] Grandchild'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtaskRange).toEqual({ from: 1, to: 2 });
  });

  it('skips empty lines between subtasks without breaking range', () => {
    const lines = ['- [ ] Parent', '  - [ ] Child 1', '', '  - [ ] Child 2'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(2);
    expect(r.subtasks[0]?.text).toBe('Child 1');
    expect(r.subtasks[1]?.text).toBe('Child 2');
    expect(r.subtaskRange).toEqual({ from: 1, to: 3 });
  });

  it('handles tab-indented subtasks', () => {
    const lines = ['- [ ] Parent', '\t- [ ] Tab child'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtasks[0]?.text).toBe('Tab child');
  });

  it('subtask can have its own description', () => {
    const lines = ['- [ ] Parent', '  - [ ] Child', '    - > Child desc'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks[0]?.description).toBe('Child desc');
  });

  it('subtask can have its own dated comment', () => {
    const lines = ['- [ ] Parent', '  - [ ] Child', '    - 2026-01-15: Child note'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks[0]?.comments).toHaveLength(1);
    expect(r.subtasks[0]?.comments?.[0]?.date).toBe('2026-01-15');
    expect(r.subtasks[0]?.comments?.[0]?.text).toBe('Child note');
  });

  it('subtask with its own children has subtaskRange set', () => {
    const lines = ['- [ ] Root', '  - [ ] Child', '    - [ ] Grandchild'];
    const r = parseSubItems(lines, 0, FILE);
    const child = r.subtasks[0];
    expect(child?.subtaskRange).toEqual({ from: 2, to: 2 });
  });

  it('sibling after nested group is parsed correctly', () => {
    const lines = ['- [ ] Root', '  - [ ] Child A', '    - [ ] Nested', '  - [ ] Child B'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toHaveLength(2);
    expect(r.subtasks[0]?.text).toBe('Child A');
    expect(r.subtasks[1]?.text).toBe('Child B');
    expect(r.subtasks[1]?.subtasks).toBeUndefined();
  });

  it('line property is correct for deeply nested items', () => {
    const lines = [
      '- [ ] Root', // line 0
      '  - [ ] Child', // line 1
      '    - [ ] Grand', // line 2
    ];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks[0]?.line).toBe(1);
    expect(r.subtasks[0]?.subtasks?.[0]?.line).toBe(2);
  });

  // --- Edge cases (Phase 1 coverage) ---

  it('returns empty result when taskLineIdx is the last line', () => {
    const lines = ['- [ ] Parent'];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks).toEqual([]);
    expect(r.comments).toEqual([]);
    expect(r.description).toBe('');
    expect(r.subtaskRange).toBeUndefined();
  });

  it('returns empty result for out-of-bounds taskLineIdx (CURRENT BEHAVIOR)', () => {
    // lines[taskLineIdx] ?? '' guards; getIndent('') === 0; loop starts at taskLineIdx+1 and exits immediately
    const lines = ['- [ ] Parent'];
    const r = parseSubItems(lines, 5, FILE);
    expect(r.subtasks).toEqual([]);
    expect(r.subtaskRange).toBeUndefined();
  });

  it('returns empty result for negative taskLineIdx', () => {
    const r = parseSubItems(['- [ ] Parent', '  - [ ] Child'], -1, FILE);
    expect(r.subtasks).toEqual([]);
    expect(r.subtaskRange).toBeUndefined();
  });

  it('returns empty result for an empty lines array', () => {
    const r = parseSubItems([], 0, FILE);
    expect(r.subtasks).toEqual([]);
    expect(r.subtaskRange).toBeUndefined();
  });

  it('treats a cancelled subtask checkbox as a comment (CURRENT BEHAVIOR, follow-up FU-1)', () => {
    // SUBTASK_RE only matches [ xX]; [-] falls through to the comment branch
    // COMMENT_RE captures group 2 after "- " → "[-] Cancelled child"
    const r = parseSubItems(['- [ ] Parent', '  - [-] Cancelled child'], 0, FILE);
    expect(r.subtasks).toEqual([]);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]?.text).toBe('[-] Cancelled child');
  });

  it('treats an in-progress subtask checkbox as a comment (CURRENT BEHAVIOR, follow-up FU-1)', () => {
    const r = parseSubItems(['- [ ] Parent', '  - [/] In-progress child'], 0, FILE);
    expect(r.subtasks).toEqual([]);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]?.text).toBe('[/] In-progress child');
  });

  it('preserves metadata emojis in subtask text (parser does not recurse parseTask)', () => {
    const r = parseSubItems(['- [ ] Parent', '  - [ ] Child 📅 2026-01-01'], 0, FILE);
    expect(r.subtasks[0]?.text).toBe('Child 📅 2026-01-01');
  });

  it('handles mixed tab and space indentation across parent and child', () => {
    // parent 2 spaces (indent 2), child 1 tab (normalized to 4) → child indent 4 > parent 2
    const r = parseSubItems(['  - [ ] Parent', '\t- [ ] Child'], 0, FILE);
    expect(r.subtasks).toHaveLength(1);
    expect(r.subtasks[0]?.text).toBe('Child');
  });

  it('a structurally-shaped-but-invalid date still matches COMMENT_DATE_RE (CURRENT BEHAVIOR)', () => {
    // 2026-13-99 has \d{4}-\d{2}-\d{2} shape, so COMMENT_DATE_RE matches it as a dated comment
    const r = parseSubItems(['- [ ] Parent', '  - 2026-13-99: bad'], 0, FILE);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]?.date).toBe('2026-13-99');
    expect(r.comments[0]?.text).toBe('bad');
  });

  it('a single-digit-day date does not match COMMENT_DATE_RE and falls back to a plain comment', () => {
    // 2026-13-9 lacks the \d{2} day shape, so it is not a dated comment
    const r = parseSubItems(['- [ ] Parent', '  - 2026-13-9: bad'], 0, FILE);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]?.date).toBeUndefined();
    expect(r.comments[0]?.text).toBe('2026-13-9: bad');
  });

  it('a dropped unrecognized indented line is excluded from groups but stays in range (CURRENT BEHAVIOR, follow-up FU-6)', () => {
    const r = parseSubItems(['- [ ] Parent', '    plain text'], 0, FILE);
    expect(r.subtasks).toEqual([]);
    expect(r.comments).toEqual([]);
    // rangeTo = i is set before pattern matching, so the dropped line is in the range
    expect(r.subtaskRange).toEqual({ from: 1, to: 1 });
  });

  it('subtaskRange.to covers the last nested descendant before a sibling', () => {
    const lines = [
      '- [ ] Root', // 0
      '  - [ ] Child A', // 1
      '    - [ ] Nested', // 2
      '  - [ ] Child B', // 3
    ];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtaskRange).toEqual({ from: 1, to: 3 });
    expect(r.subtasks[0]?.subtaskRange).toEqual({ from: 2, to: 2 });
    // sibling starts at rangeTo + 1
    expect(r.subtasks[1]?.line).toBe(3);
  });

  it('empty lines between subtasks do not corrupt line numbers', () => {
    const lines = [
      '- [ ] Parent', // 0
      '  - [ ] Child 1', // 1
      '', // 2 (skipped, not in range)
      '  - [ ] Child 2', // 3
    ];
    const r = parseSubItems(lines, 0, FILE);
    expect(r.subtasks[0]?.line).toBe(1);
    expect(r.subtasks[1]?.line).toBe(3);
    expect(r.subtaskRange).toEqual({ from: 1, to: 3 });
  });
});
