import { Notice } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCommandResult } from '../src/tasks';
import { presentTaskCommandResult, presentTaskCreationResult } from '../src/ui/taskCommandResult';

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

  it('announces a successful task creation with only its destination filename', () => {
    presentTaskCreationResult({
      type: 'ok',
      changed: true,
      outcome: {
        type: 'task',
        task: { source: { filePath: 'daily/2026-07-14.md' } } as never,
      },
    });
    expect(noticeCalls()).toEqual([['Task added to 2026-07-14.md']]);
  });

  it.each([
    [
      'an unavailable destination',
      {
        type: 'invalid',
        issues: [{ code: 'destination-unavailable', field: 'destination' }],
      },
      'No target file found for task.',
    ],
    [
      'an I/O failure',
      { type: 'io-error', cause: 'process-error', contentState: 'unknown' },
      'Failed to create task. Please try again.',
    ],
    [
      'invalid task input',
      { type: 'invalid', issues: [{ code: 'invalid-title', field: 'title' }] },
      'The new task is invalid and was not created.',
    ],
  ] as const)('uses creation-specific language for %s', (_name, result, message) => {
    presentTaskCreationResult(result as TaskCommandResult);
    expect(noticeCalls()).toEqual([[message]]);
  });
});
