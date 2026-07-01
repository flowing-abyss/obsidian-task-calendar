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

/** Parse [[wiki]], [[wiki|alias]] and [md](url) links in document order. */
export function parseLinks(input: string): LinkToken[] {
  const tokens: LinkToken[] = [];
  // Single combined scan preserves ordering; wiki matched before md at same spot.
  const combined = /\[\[([^|[\]]+)(?:\|([^[\]]+))?\]\]|\[([^[\]]+)\]\(([^)]+)\)/gu;
  let m: RegExpExecArray | null;
  while ((m = combined.exec(input)) !== null) {
    if (m[1] !== undefined) {
      const target = m[1];
      const alias = m[2];
      tokens.push({
        raw: m[0],
        type: 'wiki',
        target,
        display: alias ?? target.replace(/\.[^.]*$/u, '').replace(/^.*\//u, ''),
        index: m.index,
      });
    } else {
      tokens.push({
        raw: m[0],
        type: 'md',
        target: m[4] ?? '',
        display: m[3] ?? '',
        index: m.index,
      });
    }
  }
  return tokens;
}
