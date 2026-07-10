import { describe, expect, it } from 'vitest';
import {
  minutesToPixels,
  minutesToTimeString,
  packOverlaps,
  PIXELS_PER_HOUR,
  pixelsToMinutes,
  snapMinutes,
  timeStringToMinutes,
  type TimedBlockInput,
} from '../src/views/timegrid/layout';
import { task } from './helpers';

describe('time/pixel conversions', () => {
  it('minutesToPixels scales by PIXELS_PER_HOUR', () => {
    expect(minutesToPixels(60)).toBe(PIXELS_PER_HOUR);
    expect(minutesToPixels(30)).toBe(PIXELS_PER_HOUR / 2);
  });
  it('pixelsToMinutes is the inverse of minutesToPixels', () => {
    expect(pixelsToMinutes(PIXELS_PER_HOUR)).toBe(60);
    expect(pixelsToMinutes(48)).toBe(60);
    expect(pixelsToMinutes(minutesToPixels(90))).toBe(90);
    expect(minutesToPixels(pixelsToMinutes(120))).toBe(120);
  });
  it('timeStringToMinutes/minutesToTimeString round-trip', () => {
    expect(timeStringToMinutes('15:00')).toBe(900);
    expect(minutesToTimeString(900)).toBe('15:00');
    expect(timeStringToMinutes('09:05')).toBe(545);
    expect(minutesToTimeString(545)).toBe('09:05');
  });
  it('snapMinutes rounds to the nearest step', () => {
    expect(snapMinutes(7, 15)).toBe(0);
    expect(snapMinutes(8, 15)).toBe(15);
    expect(snapMinutes(-4, 15)).toBe(0);
  });
});

describe('packOverlaps', () => {
  const block = (start: number, duration: number): TimedBlockInput => ({
    task: task({ line: start }), // line as a cheap unique id for assertions
    startMinutes: start,
    durationMinutes: duration,
  });

  it('non-overlapping blocks each get column 0 of 1', () => {
    const result = packOverlaps([block(9 * 60, 60), block(11 * 60, 60)]);
    expect(result.every((b) => b.column === 0 && b.columns === 1)).toBe(true);
  });

  it('two overlapping blocks get columns 0 and 1, columns=2', () => {
    const result = packOverlaps([block(9 * 60, 60), block(9 * 60 + 30, 60)]);
    expect(result.map((b) => b.column).sort()).toEqual([0, 1]);
    expect(result.every((b) => b.columns === 2)).toBe(true);
  });

  it('three overlapping blocks get 3 distinct columns', () => {
    const result = packOverlaps([block(9 * 60, 90), block(9 * 60, 90), block(9 * 60, 90)]);
    expect(new Set(result.map((b) => b.column)).size).toBe(3);
    expect(result.every((b) => b.columns === 3)).toBe(true);
  });

  it('a block ending exactly when another starts does not count as overlapping', () => {
    const result = packOverlaps([block(9 * 60, 60), block(10 * 60, 60)]);
    expect(result.every((b) => b.column === 0 && b.columns === 1)).toBe(true);
  });

  it('reuses a freed column once its occupant has ended', () => {
    // A: 9-10, B: 9-10 (overlap, cols 0/1), C: 10-11 (A freed col 0 -> C takes col 0)
    const result = packOverlaps([block(9 * 60, 60), block(9 * 60, 60), block(10 * 60, 60)]);
    const c = result[2]!;
    expect(c.column).toBe(0);
  });

  it('empty input returns empty output', () => {
    expect(packOverlaps([])).toEqual([]);
  });
});
