import { describe, expect, it, vi } from 'vitest';
import type { TaskQueryApi } from '../../src/tasks/application/TaskApplicationApi';
import { TaskApplicationService } from '../../src/tasks/application/TaskApplicationService';
import type {
  TaskRepository,
  TaskRepositoryResult,
} from '../../src/tasks/application/TaskRepository';
import type { TaskRef, TaskSnapshot } from '../../src/tasks/domain/types';
import { durationMinutes, localDate, localTime } from '../../src/tasks/domain/validation';

const ref: TaskRef = { filePath: 'tasks.md', line: 0, revision: 'block:test' };

function snapshot(): TaskSnapshot {
  return {
    ref,
    title: 'task',
    markdownTitle: 'task',
    status: 'open',
    statusSymbol: ' ',
    priority: 'D',
    planning: { due: localDate('2026-07-20') },
    tags: [],
    subtasks: [],
    comments: [],
    source: { filePath: 'tasks.md', line: 0, originalMarkdown: '- [ ] task 📅 2026-07-20' },
    presentation: { linkCount: 0 },
  };
}

function queries(): TaskQueryApi {
  return {
    list: () => [],
    forCalendarDates: () => [],
    resolve: (target) => ({ type: 'not-found', ref: target }),
    subscribe: () => () => {},
  };
}

describe('TaskApplicationService planning commands', () => {
  it('delegates a typed planning patch and maps a committed result', async () => {
    const committed: TaskRepositoryResult = {
      type: 'committed',
      outcome: { type: 'task', task: snapshot() },
      changed: true,
    };
    const edit = vi.fn<TaskRepository['edit']>().mockResolvedValue(committed);
    const service = new TaskApplicationService(queries(), { edit });
    const command = {
      type: 'patch' as const,
      target: { type: 'task' as const, ref },
      patch: { due: { type: 'set' as const, value: localDate('2026-07-20') } },
    };

    await expect(service.execute(command)).resolves.toEqual({
      type: 'ok',
      outcome: committed.outcome,
      changed: true,
    });
    expect(edit).toHaveBeenCalledWith(command);
  });

  it.each<TaskRepositoryResult>([
    { type: 'conflict', current: snapshot() },
    { type: 'not-found', target: { type: 'task', ref } },
    { type: 'ambiguous', candidates: [{ root: snapshot(), target: { type: 'task', ref } }] },
    { type: 'invalid', issues: [{ code: 'inverted-span', field: 'start,due' }] },
    {
      type: 'io-error',
      cause: 'disk unavailable',
      path: 'tasks.md',
      contentState: 'unknown',
    },
  ])('preserves the structured repository result $type', async (result) => {
    const repository: TaskRepository = { edit: vi.fn().mockResolvedValue(result) };
    const service = new TaskApplicationService(queries(), repository);

    await expect(
      service.execute({ type: 'reschedule', ref, date: localDate('2026-07-21') }),
    ).resolves.toEqual(result);
  });

  it('maps an unexpected adapter rejection without leaking task Markdown', async () => {
    const repository: TaskRepository = {
      edit: vi.fn().mockRejectedValue(new Error('- [ ] secret task')),
    };
    const service = new TaskApplicationService(queries(), repository);

    await expect(
      service.execute({ type: 'reschedule', ref, date: localDate('2026-07-21') }),
    ).resolves.toEqual({
      type: 'io-error',
      cause: 'repository-error',
      contentState: 'unknown',
    });
  });

  it.each([
    {
      type: 'set-time-slot' as const,
      ref,
      date: localDate('2026-07-21'),
      time: localTime('09:30'),
      duration: durationMinutes(90),
    },
    { type: 'convert-to-all-day' as const, ref, date: localDate('2026-07-21') },
    {
      type: 'set-span-boundary' as const,
      ref,
      boundary: 'start' as const,
      date: localDate('2026-07-19'),
    },
    { type: 'extend-span' as const, ref, due: localDate('2026-07-22') },
  ])('delegates the semantic $type command unchanged', async (command) => {
    const committed: TaskRepositoryResult = {
      type: 'committed',
      outcome: { type: 'task', task: snapshot() },
      changed: true,
    };
    const edit = vi.fn<TaskRepository['edit']>().mockResolvedValue(committed);
    const service = new TaskApplicationService(queries(), { edit });

    await expect(service.execute(command)).resolves.toEqual({
      type: 'ok',
      outcome: committed.outcome,
      changed: true,
    });
    expect(edit).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledWith(command);
  });
});
