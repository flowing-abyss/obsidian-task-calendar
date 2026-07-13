import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { RightPanel } from '../src/panels/RightPanel';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { toStatusRules } from '../src/settings/statusCatalogAdapter';
import { TaskStore } from '../src/store/TaskStore';
import type { TaskApplicationApi } from '../src/tasks';
import { StatusCatalog } from '../src/tasks/domain/StatusCatalog';
import { createAppWithFiles, queryApiForTasks } from './helpers';

describe('status and priority consumer delegation', () => {
  it('TaskStore forwards toggle, selected symbol, and typed priority to the shared API', async () => {
    const app = await createAppWithFiles({ 'tasks.md': '- [ ] task' });
    const execute = vi.fn<TaskApplicationApi['execute']>().mockResolvedValue({
      type: 'invalid',
      issues: [{ code: 'invalid-status' }],
    });
    const tasks: TaskApplicationApi = { queries: queryApiForTasks(() => []), execute };
    const store = new TaskStore(app, DEFAULT_SETTINGS, undefined, tasks);
    const task = {
      filePath: 'tasks.md',
      line: 0,
      rawText: '- [ ] task',
      text: 'task',
      markdownText: 'task',
      status: 'open' as const,
      statusSymbol: ' ',
      priority: 'D' as const,
      ref: { filePath: 'tasks.md', line: 0, revision: 'block:task' },
    };

    await store.toggleTask(task);
    await store.setTaskStatus(task, '/');
    await store.setPriority(task, 'F');

    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      { type: 'toggle-completion', target: { type: 'task', ref: task.ref } },
      { type: 'set-status', target: { type: 'task', ref: task.ref }, symbol: '/' },
      {
        type: 'patch',
        target: { type: 'task', ref: task.ref },
        patch: { priority: { type: 'set', value: 'F' } },
      },
    ]);
  });

  it('RightPanel forwards nested toggle, selected symbol, and priority without formatting Markdown', async () => {
    const app = await createAppWithFiles({ 'tasks.md': '- [ ] root\n  - [ ] child' });
    const execute = vi.fn<TaskApplicationApi['execute']>().mockResolvedValue({
      type: 'invalid',
      issues: [{ code: 'invalid-target' }],
    });
    const tasks: TaskApplicationApi = { queries: queryApiForTasks(() => []), execute };
    const panel = new RightPanel(new AppState(), app, DEFAULT_SETTINGS, undefined, tasks);
    const ref = {
      parent: {
        type: 'task' as const,
        ref: { filePath: 'tasks.md', line: 0, revision: 'block:root' },
      },
      relativeLine: 1,
      originalBlock: '  - [ ] child',
    };
    const child = {
      filePath: 'tasks.md',
      line: 1,
      rawText: '  - [ ] child',
      text: 'child',
      markdownText: 'child',
      status: 'open' as const,
      statusSymbol: ' ',
      priority: 'D' as const,
      ref,
    };
    const invoke = async (method: string, ...args: unknown[]) => {
      const fn = (panel as unknown as Record<string, (...values: unknown[]) => Promise<void>>)[
        method
      ]!;
      await fn.call(panel, ...args);
    };

    await invoke('toggleSubTask', child);
    await invoke('setStatus', child, '/');
    await invoke('updatePriority', child, 'A');

    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      { type: 'toggle-completion', target: { type: 'subtask', ref } },
      { type: 'set-status', target: { type: 'subtask', ref }, symbol: '/' },
      {
        type: 'patch',
        target: { type: 'subtask', ref },
        patch: { priority: { type: 'set', value: 'A' } },
      },
    ]);
  });

  it('keeps the composition-root StatusCatalog live when settings are rebuilt', async () => {
    const app = await createAppWithFiles({});
    const settings = {
      ...DEFAULT_SETTINGS,
      taskStatuses: DEFAULT_SETTINGS.taskStatuses.map((status) => ({ ...status })),
    };
    const catalog = new StatusCatalog(toStatusRules(settings.taskStatuses));
    const store = new TaskStore(app, settings, undefined, undefined, catalog);
    settings.taskStatuses.push({
      id: 'waiting',
      symbol: 'w',
      name: 'Waiting',
      type: 'in-progress',
      icon: '',
      core: false,
    });

    store.rebuildStatusRegistry();

    expect(catalog.ruleForSymbol('w')).toMatchObject({ id: 'waiting', type: 'in-progress' });
  });
});
