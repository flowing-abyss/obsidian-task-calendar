import type { DurationMinutes, LocalDate, LocalTime } from './types';

export function localDate(value: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error('invalid-date');
  const [, ys, ms, ds] = match;
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1]!) {
    throw new Error('invalid-date');
  }
  return value as LocalDate;
}

export function localTime(value: string): LocalTime {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) throw new Error('invalid-time');
  return value as LocalTime;
}

export function durationMinutes(value: number): DurationMinutes {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error('invalid-duration');
  }
  return value as DurationMinutes;
}
