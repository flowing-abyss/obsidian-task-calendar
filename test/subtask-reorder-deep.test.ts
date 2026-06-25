import { describe, expect, it } from 'vitest';
import { applySubtaskReorder } from '../src/parser/subtask-reorder';

describe('applySubtaskReorder deep edges', () => {
  it('moves block down with position=before (L23 false branch)', () => {
    // moved.line < target.line → adjusted branch; position !== 'before' → false → adjRangeTo + 1
    // To hit L23 false: moved.line < target.line AND position === 'before'
    const content = ['- [ ] Parent', '  - [ ] A', '  - [ ] B', '  - [ ] C'].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 1, rangeTo: 1 },
      { line: 3, rangeTo: 3 },
      'before',
    );
    // A moved before C: adjLine = 3 - 1 = 2; position before → insertAt = 2
    expect(result.split('\n')).toEqual([
      '- [ ] Parent',
      '  - [ ] B',
      '  - [ ] A',
      '  - [ ] C',
    ]);
  });

  it('moves block up with position=after (L26 false branch)', () => {
    // moved.line > target.line → unadjusted branch; position === 'after' → false → target.rangeTo + 1
    // To hit L26 false: moved.line > target.line AND position === 'after'
    const content = ['- [ ] Parent', '  - [ ] A', '  - [ ] B', '  - [ ] C'].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 3, rangeTo: 3 },
      { line: 1, rangeTo: 1 },
      'after',
    );
    // C moved after A: insertAt = 1 + 1 = 2
    expect(result.split('\n')).toEqual([
      '- [ ] Parent',
      '  - [ ] A',
      '  - [ ] C',
      '  - [ ] B',
    ]);
  });

  it('moves multi-line block down with position=before', () => {
    const content = [
      '- [ ] Parent',
      '  - [ ] A',
      '    - [ ] A1',
      '  - [ ] B',
      '  - [ ] C',
    ].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 1, rangeTo: 2 },
      { line: 4, rangeTo: 4 },
      'before',
    );
    expect(result.split('\n')).toEqual([
      '- [ ] Parent',
      '  - [ ] B',
      '  - [ ] A',
      '    - [ ] A1',
      '  - [ ] C',
    ]);
  });

  it('moves multi-line block up with position=after', () => {
    const content = [
      '- [ ] Parent',
      '  - [ ] A',
      '  - [ ] B',
      '    - [ ] B1',
      '  - [ ] C',
    ].join('\n');
    const result = applySubtaskReorder(
      content,
      { line: 4, rangeTo: 4 },
      { line: 1, rangeTo: 2 },
      'after',
    );
    // C moved after A block (line 1, rangeTo 2): insertAt = 2 + 1 = 3
    // CURRENT BEHAVIOR: moved.line (4) > target.line (1), so unadjusted branch;
    // position='after' → insertAt = target.rangeTo + 1 = 3. After splicing out C,
    // lines = [Parent, A, B, B1]; splice(3, 0, C) → [Parent, A, B, C, B1].
    expect(result.split('\n')).toEqual([
      '- [ ] Parent',
      '  - [ ] A',
      '  - [ ] B',
      '  - [ ] C',
      '    - [ ] B1',
    ]);
  });

  it('same line is no-op (already covered, verifying stability)', () => {
    const content = '- [ ] Parent\n  - [ ] A\n  - [ ] B';
    expect(
      applySubtaskReorder(content, { line: 1, rangeTo: 1 }, { line: 1, rangeTo: 1 }, 'before'),
    ).toBe(content);
  });
});