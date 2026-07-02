import { describe, expect, it } from 'vitest';
import {
  buildLinkRaw,
  countLinksIn,
  pairAnchorsToTokens,
  parseLinks,
  rewriteNthLink,
  type LinkToken,
} from '../src/parser/links';

describe('countLinksIn', () => {
  it('sums wiki + markdown links across all given texts, skipping undefined', () => {
    const count = countLinksIn([
      'title [[Note]] and [ext](http://x)', // 2
      undefined,
      'desc [[Other]]', // 1
      'a comment with no links', // 0
      '![[embed.png]] is not a link', // 0 (embeds excluded)
    ]);
    expect(count).toBe(3);
  });
  it('is 0 for empty input', () => {
    expect(countLinksIn([])).toBe(0);
    expect(countLinksIn([undefined, ''])).toBe(0);
  });
});

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

  it('does not tokenize an image as a markdown link', () => {
    expect(parseLinks('![alt](a.png)')).toEqual([]);
  });

  it('does not tokenize an embed as a wiki link', () => {
    expect(parseLinks('![[Embed]]')).toEqual([]);
  });

  it('tokenizes only the real link when an image precedes it', () => {
    const toks = parseLinks('text ![i](x.png) and [real](http://y)');
    expect(toks).toHaveLength(1);
    expect(toks[0]).toMatchObject({ type: 'md', target: 'http://y', display: 'real' });
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

function mkWiki(target: string, display: string): LinkToken {
  return { raw: `[[${target}]]`, type: 'wiki', target, display, index: 0 };
}

function mkMd(target: string, display: string): LinkToken {
  return { raw: `[${display}](${target})`, type: 'md', target, display, index: 0 };
}

describe('pairAnchorsToTokens', () => {
  it('pairs two anchors to two tokens in order', () => {
    const tokens = [mkWiki('A', 'A'), mkWiki('B', 'B')];
    const anchors = [
      { text: 'A', href: 'A' },
      { text: 'B', href: 'B' },
    ];
    expect(pairAnchorsToTokens(anchors, tokens)).toEqual([0, 1]);
  });

  it('skips a code-span token that has no matching anchor', () => {
    const tokens = [mkWiki('NotALink', 'NotALink'), mkWiki('Real', 'Real')];
    const anchors = [{ text: 'Real', href: 'Real' }];
    expect(pairAnchorsToTokens(anchors, tokens)).toEqual([1]);
  });

  it('does not let a bare-URL anchor consume the real link token', () => {
    const tokens = [mkMd('http://y', 'real')];
    const anchors = [
      { text: 'https://bare', href: 'https://bare' },
      { text: 'real', href: 'http://y' },
    ];
    expect(pairAnchorsToTokens(anchors, tokens)).toEqual([-1, 0]);
  });

  it('pairs duplicate display text anchors to distinct token occurrences', () => {
    const tokens = [mkMd('x', 'a'), mkMd('y', 'a')];
    const anchors = [
      { text: 'a', href: 'x' },
      { text: 'a', href: 'y' },
    ];
    expect(pairAnchorsToTokens(anchors, tokens)).toEqual([0, 1]);
  });

  it('matches a wiki alias anchor by href against the token target', () => {
    const tokens = [mkWiki('Sources', 'secondary sources')];
    const anchors = [{ text: 'secondary sources', href: 'Sources' }];
    expect(pairAnchorsToTokens(anchors, tokens)).toEqual([0]);
  });
});
