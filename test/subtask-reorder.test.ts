import { describe, expect, it } from 'vitest';
import { applySubtaskReorder } from '../src/parser/subtask-reorder';

describe('applySubtaskReorder', () => {
  it('moves a subtask down (insert after later sibling)', () => {
    const content = ['- [ ] Parent', '  - [ ] First', '  - [ ] Second', '  - [ ] Third'].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 1, rangeTo: 1 },
      { line: 3, rangeTo: 3 },
      'after',
    );
    expect(result.split('\n')).toEqual([
      '- [ ] Parent',
      '  - [ ] Second',
      '  - [ ] Third',
      '  - [ ] First',
    ]);
  });

  it('moves a subtask up (insert before earlier sibling)', () => {
    const content = ['- [ ] Parent', '  - [ ] First', '  - [ ] Second', '  - [ ] Third'].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 3, rangeTo: 3 },
      { line: 1, rangeTo: 1 },
      'before',
    );
    expect(result.split('\n')).toEqual([
      '- [ ] Parent',
      '  - [ ] Third',
      '  - [ ] First',
      '  - [ ] Second',
    ]);
  });

  it('moves a subtask immediately after its predecessor (down one)', () => {
    const content = ['- [ ] Parent', '  - [ ] A', '  - [ ] B', '  - [ ] C'].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 1, rangeTo: 1 },
      { line: 2, rangeTo: 2 },
      'after',
    );
    expect(result.split('\n')).toEqual(['- [ ] Parent', '  - [ ] B', '  - [ ] A', '  - [ ] C']);
  });

  it('moves a subtask with its entire children block', () => {
    const content = [
      '- [ ] Parent',
      '  - [ ] Task A',
      '    - [ ] Sub A1',
      '    - [ ] Sub A2',
      '  - [ ] Task B',
    ].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 1, rangeTo: 3 },
      { line: 4, rangeTo: 4 },
      'after',
    );
    expect(result.split('\n')).toEqual([
      '- [ ] Parent',
      '  - [ ] Task B',
      '  - [ ] Task A',
      '    - [ ] Sub A1',
      '    - [ ] Sub A2',
    ]);
  });

  it('moves a multi-line block up before a single-line sibling', () => {
    const content = [
      '- [ ] Parent',
      '  - [ ] Task A',
      '  - [ ] Task B',
      '    - [ ] Sub B1',
      '    - [ ] Sub B2',
    ].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 2, rangeTo: 4 },
      { line: 1, rangeTo: 1 },
      'before',
    );
    expect(result.split('\n')).toEqual([
      '- [ ] Parent',
      '  - [ ] Task B',
      '    - [ ] Sub B1',
      '    - [ ] Sub B2',
      '  - [ ] Task A',
    ]);
  });

  it('is a no-op when moving a subtask before itself', () => {
    const content = ['- [ ] Parent', '  - [ ] First', '  - [ ] Second'].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 1, rangeTo: 1 },
      { line: 1, rangeTo: 1 },
      'before',
    );
    expect(result).toBe(content);
  });

  it('is a no-op when moving a subtask after itself', () => {
    const content = ['- [ ] Parent', '  - [ ] First', '  - [ ] Second'].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 1, rangeTo: 1 },
      { line: 1, rangeTo: 1 },
      'after',
    );
    expect(result).toBe(content);
  });

  it('preserves unrelated lines above and below parent', () => {
    const content = [
      '# Heading',
      '- [ ] Parent',
      '  - [ ] First',
      '  - [ ] Second',
      '',
      '- [ ] Another task',
    ].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 2, rangeTo: 2 },
      { line: 3, rangeTo: 3 },
      'after',
    );
    expect(result.split('\n')).toEqual([
      '# Heading',
      '- [ ] Parent',
      '  - [ ] Second',
      '  - [ ] First',
      '',
      '- [ ] Another task',
    ]);
  });
});
