import { describe, expect, it } from 'vitest';
import { validateMutatedTaskLine } from '../src/mutation/validateMutatedLine';

const ctx = { filePath: 'f.md', line: 0 };

describe('validateMutatedTaskLine', () => {
  it('accepts an ordinary, well-formed task line', () => {
    expect(validateMutatedTaskLine('- [ ] Gym ⏰ 10:00 ⏱️ 1h 📅 2026-07-11', ctx)).toBe(true);
  });

  it('accepts a plain task with no metadata at all', () => {
    expect(validateMutatedTaskLine('- [ ] Buy milk', ctx)).toBe(true);
  });

  it('rejects the Task 33 disappearing-task scenario: an out-of-range hour that fails to parse back into `time`', () => {
    // "2093:15" has a 3-digit hour, which ⏰'s \d{1,2} grammar cannot match — the token silently
    // fails to parse, `time` comes back undefined, and the literal text leaks into the title.
    const line = '- [ ] Drag test alpha ⏰ 2093:15 ⏱️ 1h 📅 2026-07-11';
    expect(validateMutatedTaskLine(line, ctx)).toBe(false);
  });

  it('rejects a semantically-impossible but syntactically 2-digit hour (25:00)', () => {
    expect(validateMutatedTaskLine('- [ ] t ⏰ 25:00 📅 2026-07-11', ctx)).toBe(false);
  });

  it('rejects a semantically-impossible minute (10:75)', () => {
    expect(validateMutatedTaskLine('- [ ] t ⏰ 10:75 📅 2026-07-11', ctx)).toBe(false);
  });

  it('accepts the boundary time 23:59', () => {
    expect(validateMutatedTaskLine('- [ ] t ⏰ 23:59 📅 2026-07-11', ctx)).toBe(true);
  });

  it('rejects a zero/negative-looking duration token that parses to a non-positive value', () => {
    // A bare "⏱️" with no digits parses as undefined duration in parseTask (treated as plain
    // text there), but here the glyph is present with no recognizable positive value attached.
    expect(validateMutatedTaskLine('- [ ] t ⏱️ 0m 📅 2026-07-11', ctx)).toBe(false);
  });

  it('rejects an impossible calendar date (day 32)', () => {
    expect(validateMutatedTaskLine('- [ ] t 📅 2026-07-32', ctx)).toBe(false);
  });

  it('rejects an impossible calendar date (month 13)', () => {
    expect(validateMutatedTaskLine('- [ ] t 📅 2026-13-01', ctx)).toBe(false);
  });

  it('rejects a line that no longer matches the task-line grammar at all', () => {
    expect(validateMutatedTaskLine('not a task line', ctx)).toBe(false);
  });

  it('accepts a valid start (🛫) date used by extendTaskToSpan', () => {
    expect(validateMutatedTaskLine('- [ ] t 🛫 2026-07-01 📅 2026-07-05', ctx)).toBe(true);
  });

  it('rejects an invalid start (🛫) date', () => {
    expect(validateMutatedTaskLine('- [ ] t 🛫 2026-02-30 📅 2026-07-05', ctx)).toBe(false);
  });

  it('Task 51: rejects an inverted span where start is strictly after due', () => {
    // The exact repro: dragging a 3-day span's left edge past its own due date produced this
    // literal line — both fields individually well-formed, but start (2026-07-16) is after
    // due (2026-07-15).
    expect(validateMutatedTaskLine('- [ ] t 🛫 2026-07-16 📅 2026-07-15', ctx)).toBe(false);
  });

  it('Task 51: accepts a same-day start/due span (start === due is a legitimate boundary)', () => {
    expect(validateMutatedTaskLine('- [ ] t 🛫 2026-07-15 📅 2026-07-15', ctx)).toBe(true);
  });

  it('Task 51: still accepts an ordinary non-inverted span (start before due)', () => {
    expect(validateMutatedTaskLine('- [ ] t 🛫 2026-07-13 📅 2026-07-15', ctx)).toBe(true);
  });
});
