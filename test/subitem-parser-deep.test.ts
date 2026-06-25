import { describe, expect, it } from 'vitest';
import { parseSubItems } from '../src/parser/SubItemParser';

const FILE = 'test.md';

describe('parseSubItems deep edges', () => {
  describe('optional chaining fallbacks', () => {
    it('getIndent handles line with no indent (L18)', () => {
      // INDENT_RE.exec('no indent') → match[1] = '' → raw.replace('\t','    ') = '' → 0
      const r = parseSubItems(['- [ ] Parent', '  - [ ] Child'], 0, FILE);
      expect(r.subtasks).toHaveLength(1);
      // Indirectly: child indent 2 > parent indent 0
    });

    it('subtask with empty content after checkbox (L29, L30, L31)', () => {
      // CURRENT BEHAVIOR (follow-up: FU-33): SUBTASK_RE uses `\s+` after `]`,
      // so `  - [ ]` (no trailing whitespace) does NOT match → no subtask.
      // The brief assumed `\s*` semantics; src/ intentionally requires `\s+`.
      // Do NOT fix src/ without confirming intended grammar.
      const r = parseSubItems(['- [ ] Parent', '  - [ ]'], 0, FILE);
      expect(r.subtasks).toHaveLength(0);
    });

    it('subtask with checkbox + single space then empty (L29, L30, L31)', () => {
      // `  - [ ] ` (trailing space) matches: match[3] = '' → extractMetadata('') → cleanText ''
      const r = parseSubItems(['- [ ] Parent', '  - [ ] '], 0, FILE);
      expect(r.subtasks).toHaveLength(1);
      expect(r.subtasks[0]?.text).toBe('');
      expect(r.subtasks[0]?.status).toBe('open');
      expect(r.subtasks[0]?.priority).toBe('D');
    });

    it('subtask with only spaces after checkbox (L29)', () => {
      const r = parseSubItems(['- [ ] Parent', '  - [ ]   '], 0, FILE);
      expect(r.subtasks).toHaveLength(1);
      expect(r.subtasks[0]?.text).toBe('');
    });

    it('subtask metadata fields use optional spread (L43)', () => {
      // ...(meta.due !== undefined && { due: meta.due }) — when due IS defined, spread includes it
      const r = parseSubItems(['- [ ] Parent', '  - [ ] Task 📅 2026-07-01'], 0, FILE);
      expect(r.subtasks[0]?.due).toBe('2026-07-01');
    });
  });

  describe('line===undefined break', () => {
    it('breaks when lines array is exhausted mid-parse (L77)', () => {
      // While loop: lines[i] === undefined → break
      // This happens normally when we reach end of array
      const r = parseSubItems(['- [ ] Parent', '  - [ ] Child'], 0, FILE);
      expect(r.subtasks).toHaveLength(1);
      // The break at L77 is the normal exit path when array ends
    });

    it('breaks when taskLineIdx points beyond array end', () => {
      const r = parseSubItems(['- [ ] Parent'], 5, FILE);
      expect(r.subtasks).toEqual([]);
      // lines[5] === undefined at the start of while loop → break immediately
    });
  });

  describe('match group fallbacks', () => {
    it('description line with no text after > (L100)', () => {
      // DESCRIPTION_RE: /^(\s*)- > (.*)/  — '  - > ' → match[2] = '' → trimmed to ''
      const r = parseSubItems(['- [ ] Parent', '  - > '], 0, FILE);
      expect(r.description).toBe('');
    });

    it('dated comment with no text after date (L110)', () => {
      // COMMENT_DATE_RE: /^(\s*)- (\d{4}-\d{2}-\d{2}):\s*(.*)/
      // '  - 2026-06-25: ' → match[3] = '' → trimmed to ''
      const r = parseSubItems(['- [ ] Parent', '  - 2026-06-25: '], 0, FILE);
      expect(r.comments).toHaveLength(1);
      expect(r.comments[0]?.text).toBe('');
      expect(r.comments[0]?.date).toBe('2026-06-25');
    });

    it('undated comment with no text (L118)', () => {
      // COMMENT_RE: /^(\s*)- (.+)/  — requires at least one char after '- '
      // '  - ' with nothing → doesn't match COMMENT_RE (needs .+) → falls through to i++
      const r = parseSubItems(['- [ ] Parent', '  - '], 0, FILE);
      expect(r.comments).toHaveLength(0);
      // Line is indented but doesn't match any pattern → i++ (line 123)
    });

    it('undated comment with single char text (L118)', () => {
      // '  - x' → COMMENT_RE matches, match[2] = 'x' → trimmed to 'x'
      const r = parseSubItems(['- [ ] Parent', '  - x'], 0, FILE);
      expect(r.comments).toHaveLength(1);
      expect(r.comments[0]?.text).toBe('x');
    });
  });
});