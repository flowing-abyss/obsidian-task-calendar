export function evaluateQuery(
  query: string,
  filePath: string,
  fileTags: string[],
  frontmatter: Record<string, unknown>,
): boolean {
  if (!query.trim()) return false;
  const orGroups = splitOuter(query, ' OR ');
  return orGroups.some((group) => {
    const andTerms = splitOuter(group, ' AND ');
    return andTerms.every((term) => evaluateTerm(term.trim(), filePath, fileTags, frontmatter));
  });
}

function splitOuter(input: string, sep: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let inQuote = false;
  let quoteChar = '';
  let start = 0;
  const s = input.toUpperCase();
  const sepUpper = sep.toUpperCase();
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? '';
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && s.startsWith(sepUpper, i)) {
      results.push(input.slice(start, i).trim());
      i += sep.length - 1;
      start = i + 1;
    }
  }
  results.push(input.slice(start).trim());
  return results.filter(Boolean);
}

function evaluateTerm(
  raw: string,
  filePath: string,
  fileTags: string[],
  frontmatter: Record<string, unknown>,
): boolean {
  let term = raw.trim();
  let negate = false;
  while (term) {
    if (term.startsWith('-')) {
      negate = !negate;
      term = term.slice(1).trim();
    } else if (/^NOT\s+/i.test(term)) {
      negate = !negate;
      term = term.slice(3).trim();
    } else break;
  }
  if (!term) return false;
  const matches = evaluateBaseTerm(term, filePath, fileTags, frontmatter);
  return negate ? !matches : matches;
}

function evaluateBaseTerm(
  raw: string,
  filePath: string,
  fileTags: string[],
  frontmatter: Record<string, unknown>,
): boolean {
  let term = raw;
  if (term.startsWith('(') && term.endsWith(')')) {
    return evaluateQuery(term.slice(1, -1).trim(), filePath, fileTags, frontmatter);
  }
  if (term.startsWith('#')) {
    const tagName = term.slice(1).toLowerCase();
    return fileTags.some((t) => {
      const ft = t.replace(/^#/, '').toLowerCase();
      return ft === tagName || ft.startsWith(tagName + '/');
    });
  }
  const eqIdx = term.indexOf('=');
  if (eqIdx !== -1 && !term.startsWith('"') && !term.startsWith("'")) {
    const key = term.slice(0, eqIdx).trim();
    const val = term
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    const fmVal = frontmatter[key];
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return (fmVal === null || fmVal === undefined ? '' : String(fmVal)) === val;
  }
  const folderRaw = term.replace(/^["']|["']$/g, '');
  if (folderRaw.endsWith('/')) return filePath.startsWith(folderRaw);
  return false;
}
