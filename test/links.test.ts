import { describe, it, expect } from 'vitest';
import { parseLinks } from '../src/parser/links';

describe('parseLinks', () => {
  it('returns wiki, alias and markdown links in document order', () => {
    const s = 'a [[Note]] b [[Path/Doc|alias]] c [text](https://x.io) d';
    const toks = parseLinks(s);
    expect(toks.map((t) => t.type)).toEqual(['wiki', 'wiki', 'md']);
    expect(toks[0]).toMatchObject({ target: 'Note', display: 'Note' });
    expect(toks[1]).toMatchObject({ target: 'Path/Doc', display: 'alias' });
    expect(toks[2]).toMatchObject({ target: 'https://x.io', display: 'text' });
    expect(toks[0]!.index).toBeLessThan(toks[2]!.index);
  });

  it('returns [] when there are no links', () => {
    expect(parseLinks('plain text')).toEqual([]);
  });
});
