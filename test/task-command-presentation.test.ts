import { Notice } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCommandResult } from '../src/tasks';
import { presentTaskCommandResult } from '../src/ui/taskCommandResult';

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
  return { ...actual, Notice: vi.fn() };
});

function noticeCalls(): unknown[][] {
  return (Notice as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('task command result presentation', () => {
  beforeEach(() => {
    (Notice as unknown as { mock: { calls: unknown[][] } }).mock.calls = [];
  });

  it.each([
    ['conflict', { type: 'conflict', current: {} }],
    ['not-found', { type: 'not-found', target: {} }],
    ['ambiguous', { type: 'ambiguous', candidates: [] }],
    ['invalid', { type: 'invalid', issues: [] }],
    ['io-error', { type: 'io-error', cause: 'x', contentState: 'unknown' }],
  ] as const)('shows a presentation-owned Notice for %s', (_type, partial) => {
    presentTaskCommandResult(partial as TaskCommandResult);
    expect(noticeCalls()).toHaveLength(1);
  });

  it('keeps successful commands silent', () => {
    presentTaskCommandResult({
      type: 'ok',
      changed: false,
      outcome: { type: 'task', task: {} as never },
    });
    expect(noticeCalls()).toHaveLength(0);
  });
});
