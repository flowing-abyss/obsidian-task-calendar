import { describe, expect, it } from 'vitest';
import { formatTaskLine, parseTask } from '../src/parser/TaskParser';

describe('parseTask deep edges', () => {
  it('returns null when checkbox matches but rest is undefined (line 27)', () => {
    // CHECKBOX_RE: /^(\s*)- \[(.)\]\s*(.*)/
    // Input '- [ ]' → match[3] = '' (not undefined in normal regex, but test the guard)
    // The guard at line 27 checks `rest === undefined` — this is a defensive branch
    // that can't be reached via normal regex exec (match[3] is always string or undefined
    // when match fails entirely, but then we'd return null at line 23).
    // CURRENT BEHAVIOR: this branch is unreachable via public API.
    // We test the closest reachable case: '- [ ]' with empty rest → returns task with empty text.
    const t = parseTask('- [ ]', { filePath: 'f.md', line: 0 });
    expect(t).not.toBeNull();
    expect(t?.text).toBe('');
  });

  it('recurrence with empty capture → recurrence undefined (line 97)', () => {
    // RECURRENCE_RE.exec(text) matches but capture group [1] is empty string
    // → (match[1] ?? '').trim() || undefined → undefined
    const t = parseTask('- [ ] Task 🔁', { filePath: 'f.md', line: 0 });
    expect(t?.recurrence).toBeUndefined();
    expect(t?.text).toBe('Task');
  });

  it('recurrence with only spaces → trimmed to undefined (line 97)', () => {
    const t = parseTask('- [ ] Task 🔁   ', { filePath: 'f.md', line: 0 });
    expect(t?.recurrence).toBeUndefined();
  });
});

describe('formatTaskLine deep edges', () => {
  it('returns line as-is when no checkbox prefix (line 170)', () => {
    // FMT_PREFIX_RE: /^(\s*-\s\[[^\]]\]\s)/u — requires "- [x] " prefix
    // Line without prefix → returned unchanged
    const line = 'plain text without checkbox';
    expect(formatTaskLine(line)).toBe(line);
  });

  it('returns heading as-is when no checkbox prefix', () => {
    const line = '## My Heading';
    expect(formatTaskLine(line)).toBe(line);
  });

  it('handles created-date (➕) in canonical ordering', () => {
    const out = formatTaskLine('- [ ] Task ➕ 2026-07-05 🔁 every week 📅 2026-07-20');
    // canonical: title · 🔁 · ➕ · 📅
    expect(out).toBe('- [ ] Task 🔁 every week ➕ 2026-07-05 📅 2026-07-20');
  });

  it('preserves created-date position between recurrence and start', () => {
    const out = formatTaskLine(
      '- [ ] Task 🛫 2026-07-10 ➕ 2026-07-05 🔁 every week 📅 2026-07-20',
    );
    // canonical: title · 🔁 · ➕ · 🛫 · 📅
    expect(out).toBe('- [ ] Task 🔁 every week ➕ 2026-07-05 🛫 2026-07-10 📅 2026-07-20');
  });
});
