import { describe, expect, it } from 'vitest';
import { findTaskLine } from '../src/mutation/TaskLocator';

// ── findTaskLine ──────────────────────────────────────────────────────────────

describe('findTaskLine – fast path', () => {
  it('returns found at hint line when rawText matches exactly', () => {
    const lines = ['line0', '- [ ] Buy milk', 'line2'];
    const result = findTaskLine(lines, { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 1 });
    expect(result).toEqual({ type: 'found', line: 1 });
  });

  it('returns found when rawText contains emoji metadata', () => {
    const lines = ['- [ ] Task 📅 2026-07-01 🔺'];
    const result = findTaskLine(lines, {
      filePath: 'f.md',
      rawText: '- [ ] Task 📅 2026-07-01 🔺',
      line: 0,
    });
    expect(result).toEqual({ type: 'found', line: 0 });
  });
});

describe('findTaskLine – fallback scan after line shift', () => {
  it('finds task that moved down (lines inserted above)', () => {
    // Task was at line 0; two lines were inserted above, now at line 2.
    const lines = ['new line 1', 'new line 2', '- [ ] Buy milk'];
    const result = findTaskLine(lines, { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 0 });
    expect(result).toEqual({ type: 'found', line: 2 });
  });

  it('finds task that moved up (lines deleted above)', () => {
    const lines = ['- [ ] Buy milk', 'other'];
    // Task was at line 3 (stale hint); file changed so it is now at line 0.
    const result = findTaskLine(lines, { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 3 });
    expect(result).toEqual({ type: 'found', line: 0 });
  });

  it('finds task after it was moved to another part of the same file', () => {
    const lines = [
      '- [ ] unrelated',
      '# Section',
      '- [ ] Buy milk',
      '- [ ] other',
    ];
    // Task was at line 0 (old position); now at line 2.
    const result = findTaskLine(lines, { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 0 });
    expect(result).toEqual({ type: 'found', line: 2 });
  });
});

describe('findTaskLine – not-found', () => {
  it('returns not-found when rawText is absent', () => {
    const lines = ['- [ ] other task', '- [x] done'];
    const result = findTaskLine(lines, { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 0 });
    expect(result).toEqual({ type: 'not-found' });
  });

  it('returns not-found when file is empty', () => {
    const result = findTaskLine([], { filePath: 'f.md', rawText: '- [ ] task', line: 0 });
    expect(result).toEqual({ type: 'not-found' });
  });

  it('returns not-found when task text was changed externally', () => {
    // The file now has "Buy bread" instead of "Buy milk"
    const lines = ['- [ ] Buy bread'];
    const result = findTaskLine(lines, { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 0 });
    expect(result).toEqual({ type: 'not-found' });
  });
});

describe('findTaskLine – ambiguous (identical tasks)', () => {
  it('fast path wins over duplicate detection: found at hint line even when duplicate exists', () => {
    // lines[0] === rawText (fast path match) → returned as 'found' even though
    // a duplicate exists at line 2.  This is safe: the hint represents the task's
    // last-known position; we trust it when it matches exactly.
    const lines = ['- [ ] Buy milk', 'some header', '- [ ] Buy milk'];
    const result = findTaskLine(lines, { filePath: 'f.md', rawText: '- [ ] Buy milk', line: 0 });
    expect(result).toEqual({ type: 'found', line: 0 });
  });

  it('returns ambiguous when hint is wrong and multiple matches exist', () => {
    const lines = ['- [ ] same', '- [ ] same'];
    // hint=99 (stale) — fast path fails, full scan finds two matches
    const result = findTaskLine(lines, { filePath: 'f.md', rawText: '- [ ] same', line: 99 });
    expect(result).toEqual({ type: 'ambiguous', candidates: [0, 1] });
  });
});

describe('findTaskLine – CRLF files', () => {
  it('finds task in CRLF content (lines split on \\n preserve \\r)', () => {
    // Simulate a CRLF file: each line ends with \r when split on \n
    const crlfContent = '- [ ] task A\r\n- [ ] Buy milk\r\n- [ ] task C\r';
    const lines = crlfContent.split('\n');
    // rawText captured from the same split will have trailing \r
    const rawText = lines[1]!; // '- [ ] Buy milk\r'
    const result = findTaskLine(lines, { filePath: 'f.md', rawText, line: 1 });
    expect(result).toEqual({ type: 'found', line: 1 });
  });

  it('finds CRLF task after line shift using rawText scan', () => {
    const crlfContent = 'inserted\r\n- [ ] Buy milk\r\n';
    const lines = crlfContent.split('\n');
    const rawText = '- [ ] Buy milk\r'; // line 1 after insertion
    const result = findTaskLine(lines, { filePath: 'f.md', rawText, line: 0 }); // hint is wrong
    expect(result).toEqual({ type: 'found', line: 1 });
  });
});

describe('findTaskLine – tasks with rich metadata', () => {
  it('finds task with due date, scheduled date, time, and recurrence', () => {
    const rawText = '- [ ] Report 📅 2026-07-15 ⏳ 2026-07-10 ⏰ 09:00 🔁 every week';
    const lines = ['header', rawText, 'footer'];
    const result = findTaskLine(lines, { filePath: 'f.md', rawText, line: 1 });
    expect(result).toEqual({ type: 'found', line: 1 });
  });

  it('finds task with tags after line shift', () => {
    const rawText = '- [ ] Deploy #ops #urgent 📅 2026-06-30';
    const lines = ['inserted line', rawText];
    const result = findTaskLine(lines, { filePath: 'f.md', rawText, line: 0 });
    expect(result).toEqual({ type: 'found', line: 1 });
  });

  it('finds indented subtask', () => {
    const rawText = '    - [ ] subtask item';
    const lines = ['- [ ] parent', rawText];
    const result = findTaskLine(lines, { filePath: 'f.md', rawText, line: 1 });
    expect(result).toEqual({ type: 'found', line: 1 });
  });
});
