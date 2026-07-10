import { describe, expect, it } from 'vitest';
import {
  formatDurationFromMinutes,
  formatTaskLine,
  parseDurationToMinutes,
  parseTask,
} from '../src/parser/TaskParser';

describe('duration parsing', () => {
  it('parses hours+minutes combined', () => {
    expect(parseDurationToMinutes('1h30m')).toBe(90);
  });
  it('parses hours only', () => {
    expect(parseDurationToMinutes('2h')).toBe(120);
  });
  it('parses minutes only', () => {
    expect(parseDurationToMinutes('45m')).toBe(45);
  });
  it('returns undefined for garbage', () => {
    expect(parseDurationToMinutes('')).toBeUndefined();
  });

  it('formats to shortest form', () => {
    expect(formatDurationFromMinutes(90)).toBe('1h30m');
    expect(formatDurationFromMinutes(120)).toBe('2h');
    expect(formatDurationFromMinutes(45)).toBe('45m');
  });

  it('parseTask extracts duration and strips it from text', () => {
    const t = parseTask('- [ ] gym ⏰ 15:00 ⏱️ 2h', { filePath: 'f.md', line: 0 });
    expect(t?.time).toBe('15:00');
    expect(t?.duration).toBe(120);
    expect(t?.text).toBe('gym');
  });

  it('parseTask leaves duration undefined when absent', () => {
    const t = parseTask('- [ ] gym ⏰ 15:00', { filePath: 'f.md', line: 0 });
    expect(t?.duration).toBeUndefined();
  });

  it('formatTaskLine round-trips duration in canonical order (after time, before priority)', () => {
    const line = formatTaskLine('- [ ] gym ⏱️ 1h30m ⏰ 15:00 🔺');
    expect(line).toBe('- [ ] gym ⏰ 15:00 ⏱️ 1h30m 🔺');
  });

  it('formatTaskLine drops duration cleanly when title is re-edited without it', () => {
    // insertIntoTitleBody's boundary regex must recognize ⏱️ so it is not swallowed into the title
    const line = formatTaskLine('- [ ] gym ⏰ 15:00 ⏱️ 45m');
    expect(line).toContain('⏱️ 45m');
    expect(line).not.toContain('gym ⏱️'); // title itself must not contain the emoji
  });
});
