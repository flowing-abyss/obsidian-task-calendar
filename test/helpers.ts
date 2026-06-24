import moment from 'moment';
import { Platform } from 'obsidian';
import { afterEach, beforeEach } from 'vitest';
import type { Task } from '../src/parser/types';

/** Install real moment as window.moment for date-aware tests. Idempotent; restores in afterEach. */
export function useRealMoment(): void {
  let prev: unknown;
  beforeEach(() => {
    prev = (window as unknown as { moment?: unknown }).moment;
    (window as unknown as { moment?: unknown }).moment = moment;
  });
  afterEach(() => {
    (window as unknown as { moment?: unknown }).moment = prev;
  });
}

/** Toggle Platform.isMobile for a block; restores previous value in afterEach. */
export function withMobile(value: boolean): void {
  let prev: boolean;
  beforeEach(() => {
    prev = Platform.isMobile;
    (Platform as unknown as { isMobile: boolean }).isMobile = value;
  });
  afterEach(() => {
    (Platform as unknown as { isMobile: boolean }).isMobile = prev;
  });
}

/** Build a minimal Task satisfying the Task type; overrides win. */
export function task(overrides: Partial<Task> = {}): Task {
  return {
    filePath: 'f.md',
    line: 0,
    rawText: '- [ ] t',
    text: 't',
    status: 'open',
    priority: 'D',
    ...overrides,
  } as Task;
}
