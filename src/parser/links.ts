import { inlineCodeRanges, type SourceRange } from './inlineCode';

// Link regexes shared across parsing and collapsing.
const WIKILINK_ALIAS_RE = /\[\[([^|[\]]+)\|([^[\]]+)\]\]/gu;
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/gu;
const MD_LINK_RE = /\[([^[\]]+)\]\(([^)]+)\)/gu;
const BRACKETS_RE = /\[([^[\]]*)\]/gu;

/** Collapse links to the readable, non-clickable placeholder form (legacy `text`). */
export function collapseLinks(input: string): string {
  return input
    .replace(WIKILINK_ALIAS_RE, '🔗$1')
    .replace(WIKILINK_RE, (_m, link: string) => '🔗 ' + link.replace(/\.[^.]*$/u, ''))
    .replace(MD_LINK_RE, '🌐 $1')
    .replace(BRACKETS_RE, '$1');
}

export interface LinkToken {
  raw: string;
  type: 'wiki' | 'md';
  target: string;
  display: string;
  index: number;
}

function isEscaped(input: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && input[cursor] === '\\'; cursor--) slashCount++;
  return slashCount % 2 === 1;
}

function insideOrderedRange(
  at: number,
  ranges: readonly SourceRange[],
  cursor: { index: number },
): boolean {
  while (cursor.index < ranges.length && ranges[cursor.index]!.to <= at) cursor.index++;
  const range = ranges[cursor.index];
  return range !== undefined && at >= range.from && at < range.to;
}

/** Parse [[wiki]], [[wiki|alias]] and [md](url) links in document order. */
export function parseLinks(input: string): LinkToken[] {
  const tokens: LinkToken[] = [];
  const inlineCode = inlineCodeRanges(input);
  const wiki = /(?<!!)\[\[((?:\\.|[^|[\]])+)(?:\|((?:\\.|[^[\]])+))?\]\]/gu;
  const markdown = /(?<!!)\[((?:\\.|[^[\]])+)\]\(((?:\\.|[^)])+)\)/gu;
  let m: RegExpExecArray | null;
  const wikiRangeCursor = { index: 0 };
  while ((m = wiki.exec(input)) !== null) {
    if (isEscaped(input, m.index) || insideOrderedRange(m.index, inlineCode, wikiRangeCursor)) {
      continue;
    }
    const target = m[1] ?? '';
    const alias = m[2];
    tokens.push({
      raw: m[0],
      type: 'wiki',
      target,
      display: alias ?? target.replace(/\.[^.]*$/u, '').replace(/^.*\//u, ''),
      index: m.index,
    });
  }
  const markdownRangeCursor = { index: 0 };
  while ((m = markdown.exec(input)) !== null) {
    if (isEscaped(input, m.index) || insideOrderedRange(m.index, inlineCode, markdownRangeCursor)) {
      continue;
    }
    tokens.push({
      raw: m[0],
      type: 'md',
      target: m[2] ?? '',
      display: m[1] ?? '',
      index: m.index,
    });
  }
  return tokens.sort((left, right) => left.index - right.index);
}

/** Total number of links (wiki + markdown) across the given texts. */
export function countLinksIn(texts: Array<string | undefined>): number {
  let total = 0;
  for (const text of texts) {
    if (text) total += parseLinks(text).length;
  }
  return total;
}

/** Build the raw markup for a link, omitting the wiki alias when it equals the basename. */
export function buildLinkRaw(type: 'wiki' | 'md', target: string, display: string): string {
  if (type === 'md') return `[${display}](${target})`;
  const basename = target.replace(/\.[^.]*$/u, '').replace(/^.*\//u, '');
  return display && display !== basename ? `[[${target}|${display}]]` : `[[${target}]]`;
}

export interface AnchorDescriptor {
  text: string;
  href: string;
}

/**
 * For each anchor (in document order), find the parseLinks token it represents.
 * Returns, per anchor index, the matched token's occurrence index (its index in
 * `tokens`) or -1 if the anchor matches no token (e.g. an auto-linked bare URL).
 * Each token is consumed by at most one anchor; matching is by display text or
 * link target, scanning the first not-yet-consumed matching token.
 */
export function pairAnchorsToTokens(anchors: AnchorDescriptor[], tokens: LinkToken[]): number[] {
  const consumed = new Array(tokens.length).fill(false) as boolean[];
  return anchors.map((a) => {
    for (let k = 0; k < tokens.length; k++) {
      if (consumed[k]) continue;
      if (anchorMatchesToken(a, tokens[k]!)) {
        consumed[k] = true;
        return k;
      }
    }
    return -1;
  });
}

function anchorMatchesToken(a: AnchorDescriptor, token: LinkToken): boolean {
  const text = a.text.trim();
  if (text && text === token.display) return true;
  if (!a.href) return false;
  if (token.type === 'wiki') {
    const base = (s: string): string => s.replace(/\.[^.]*$/u, '').replace(/^.*\//u, '');
    return a.href === token.target || base(a.href) === base(token.target);
  }
  return a.href === token.target;
}
