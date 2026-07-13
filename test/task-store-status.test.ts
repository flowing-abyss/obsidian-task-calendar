import { TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { StatusCatalog } from '../src/tasks/domain/StatusCatalog';
import { localDate } from '../src/tasks/domain/validation';
import { TaskIndex } from '../src/tasks/infrastructure/TaskIndex';
import { TaskBlockEditor } from '../src/tasks/infrastructure/markdown/TaskBlockEditor';
import { TaskLocator } from '../src/tasks/infrastructure/markdown/TaskLocator';
import { TaskMarkdownCodec } from '../src/tasks/infrastructure/markdown/TaskMarkdownCodec';
import { ObsidianTaskRepository } from '../src/tasks/infrastructure/obsidian/ObsidianTaskRepository';
import { createAppWithFiles } from './helpers';

const catalog = new StatusCatalog([
  { id: 'todo', symbol: 't', type: 'todo', defaultForType: true },
  { id: 'doing', symbol: '!', type: 'in-progress', defaultForType: true },
  { id: 'done', symbol: 'd', type: 'done', defaultForType: true },
  { id: 'done-alt', symbol: 'z', type: 'done', defaultForType: false },
  { id: 'cancelled', symbol: 'c', type: 'cancelled', defaultForType: true },
  { id: 'cancelled-alt', symbol: 'k', type: 'cancelled', defaultForType: false },
]);

async function setup(source: string) {
  const app = await createAppWithFiles({ 'tasks.md': source });
  const editor = new TaskBlockEditor();
  const locator = new TaskLocator();
  const index = new TaskIndex(app, { statusCatalog: catalog, dailyNoteFormat: 'YYYY-MM-DD' });
  const repository = new ObsidianTaskRepository(app, {
    codec: new TaskMarkdownCodec(catalog),
    editor,
    locator,
    snapshotsFromContent: (path, content) => index.snapshotsFromContent(path, content),
  });
  const root = index.snapshotsFromContent('tasks.md', source)[0]!;
  const read = async () => {
    const file = app.vault.getAbstractFileByPath('tasks.md');
    if (!(file instanceof TFile)) throw new Error('missing file');
    return app.vault.cachedRead(file);
  };
  return { repository, root, read };
}

describe('status repository contract', () => {
  it.each([
    ['t', undefined],
    ['!', undefined],
    ['d', '✅'],
    ['c', '❌'],
  ] as const)('applies configured status %s atomically', async (symbol, stampMarker) => {
    const h = await setup('- [?] task 🆔 keep ⛔ dep ^block');
    const result = await h.repository.edit({
      type: 'set-status',
      target: { type: 'task', ref: h.root.ref },
      symbol,
      ...(stampMarker && { stamp: localDate('2026-07-14') }),
    });
    expect(result).toMatchObject({ type: 'committed', changed: true });
    const content = await h.read();
    expect(content).toContain(`- [${symbol}] task`);
    if (stampMarker) expect(content).toContain(`${stampMarker} 2026-07-14`);
    expect(content).toContain('🆔 keep ⛔ dep');
    expect(content).toContain('^block');
  });

  it('reopens by removing both completion and cancellation stamps', async () => {
    const h = await setup('- [d] task ✅ 2026-07-01 ❌ 2026-07-02 custom');
    await h.repository.edit({
      type: 'set-status',
      target: { type: 'task', ref: h.root.ref },
      symbol: 't',
    });
    expect(await h.read()).toBe('- [t] task custom');
  });

  it.each([
    ['d', 'z', '✅ 2026-07-01'],
    ['c', 'k', '❌ 2026-07-01'],
  ] as const)('preserves the existing stamp across same-type %s → %s', async (from, to, stamp) => {
    const h = await setup(`- [${from}] task ${stamp} custom`);
    await expect(
      h.repository.edit({
        type: 'set-status',
        target: { type: 'task', ref: h.root.ref },
        symbol: to,
      }),
    ).resolves.toMatchObject({ type: 'committed', changed: true });
    expect(await h.read()).toBe(`- [${to}] task ${stamp} custom`);
  });

  it('edits an exactly referenced nested task and returns the updated root', async () => {
    const h = await setup('- [t] root\n  - [t] child\n    - [t] nested');
    const nested = h.root.subtasks[0]!.subtasks[0]!;
    const result = await h.repository.edit({
      type: 'set-status',
      target: { type: 'subtask', ref: nested.ref },
      symbol: 'd',
      stamp: localDate('2026-07-14'),
    });
    expect(result).toMatchObject({
      type: 'committed',
      changed: true,
      outcome: { type: 'task', task: { subtasks: [{ subtasks: [{ status: 'done' }] }] } },
    });
    expect(await h.read()).toContain('    - [d] nested ✅ 2026-07-14');
  });

  it('returns unchanged for reselecting a status and stale conflict after a real change', async () => {
    const h = await setup('- [d] task ✅ 2026-07-01');
    await expect(
      h.repository.edit({
        type: 'set-status',
        target: { type: 'task', ref: h.root.ref },
        symbol: 'd',
      }),
    ).resolves.toMatchObject({ type: 'committed', changed: false });
    await h.repository.edit({
      type: 'set-status',
      target: { type: 'task', ref: h.root.ref },
      symbol: 't',
    });
    await expect(
      h.repository.edit({
        type: 'set-status',
        target: { type: 'task', ref: h.root.ref },
        symbol: '!',
      }),
    ).resolves.toMatchObject({ type: 'conflict', current: { statusSymbol: 't' } });
  });
});
