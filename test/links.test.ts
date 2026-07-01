import { describe, expect, it } from 'vitest';
import { buildLinkRaw, parseLinks, rewriteNthLink } from '../src/parser/links';

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

describe('rewriteNthLink', () => {
  it('replaces the Nth link occurrence only', () => {
    const line = '- [ ] see [[A]] and [[B]] 📅 2026-07-01';
    expect(rewriteNthLink(line, 1, '[[B|beta]]')).toBe(
      '- [ ] see [[A]] and [[B|beta]] 📅 2026-07-01',
    );
    expect(rewriteNthLink(line, 0, '[[A|alpha]]')).toBe(
      '- [ ] see [[A|alpha]] and [[B]] 📅 2026-07-01',
    );
  });
});

describe('buildLinkRaw', () => {
  it('omits the alias when display equals target basename', () => {
    expect(buildLinkRaw('wiki', 'Note', 'Note')).toBe('[[Note]]');
    expect(buildLinkRaw('wiki', 'Path/Note', 'alias')).toBe('[[Path/Note|alias]]');
    expect(buildLinkRaw('md', 'https://x.io', 'text')).toBe('[text](https://x.io)');
  });
});
