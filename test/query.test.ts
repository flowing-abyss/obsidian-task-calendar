import { describe, expect, it } from 'vitest';
import { evaluateQuery } from '../src/query/evaluateQuery';

const fm = (o: Record<string, unknown> = {}) => o;

describe('evaluateQuery', () => {
  it('matches a folder prefix', () => {
    expect(evaluateQuery('Projects/', 'Projects/A.md', [], fm())).toBe(true);
    expect(evaluateQuery('Projects/', 'Other/A.md', [], fm())).toBe(false);
  });
  it('matches a tag or child tag', () => {
    expect(evaluateQuery('#book', 'A.md', ['#book'], fm())).toBe(true);
    expect(evaluateQuery('#book', 'A.md', ['#book/scifi'], fm())).toBe(true);
    expect(evaluateQuery('#book', 'A.md', ['#audiobook'], fm())).toBe(false);
  });
  it('matches a frontmatter key=value', () => {
    expect(evaluateQuery('status=active', 'A.md', [], fm({ status: 'active' }))).toBe(true);
    expect(evaluateQuery('status=active', 'A.md', [], fm({ status: 'done' }))).toBe(false);
    expect(evaluateQuery('status=', 'A.md', [], fm())).toBe(true); // unset === ''
  });
  it('supports AND / OR / NOT / parens', () => {
    expect(evaluateQuery('Projects/ AND #book', 'Projects/A.md', ['#book'], fm())).toBe(true);
    expect(evaluateQuery('Projects/ AND #book', 'Projects/A.md', [], fm())).toBe(false);
    expect(evaluateQuery('#a OR #b', 'A.md', ['#b'], fm())).toBe(true);
    expect(evaluateQuery('Projects/ AND -#archived', 'Projects/A.md', ['#archived'], fm())).toBe(
      false,
    );
    expect(evaluateQuery('Projects/ AND NOT #archived', 'Projects/A.md', [], fm())).toBe(true);
    expect(evaluateQuery('(#a OR #b) AND Notes/', 'Notes/A.md', ['#a'], fm())).toBe(true);
  });
  it('empty query matches nothing', () => {
    expect(evaluateQuery('', 'A.md', ['#x'], fm({ status: 'active' }))).toBe(false);
    expect(evaluateQuery('   ', 'A.md', [], fm())).toBe(false);
  });
});
