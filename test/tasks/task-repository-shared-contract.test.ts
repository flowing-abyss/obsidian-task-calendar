import { TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings/defaults';
import { toStatusRules } from '../../src/settings/statusCatalogAdapter';
import type { TaskRepository } from '../../src/tasks/application/TaskRepository';
import { StatusCatalog } from '../../src/tasks/domain/StatusCatalog';
import type { TaskRef, TaskSnapshot } from '../../src/tasks/domain/types';
import { localDate } from '../../src/tasks/domain/validation';
import { TaskIndex } from '../../src/tasks/infrastructure/TaskIndex';
import { TaskBlockEditor } from '../../src/tasks/infrastructure/markdown/TaskBlockEditor';
import { TaskLocator } from '../../src/tasks/infrastructure/markdown/TaskLocator';
import { TaskMarkdownCodec } from '../../src/tasks/infrastructure/markdown/TaskMarkdownCodec';
import { ObsidianTaskRepository } from '../../src/tasks/infrastructure/obsidian/ObsidianTaskRepository';
import { createAppWithFiles } from '../helpers';
import { InMemoryTaskRepository } from '../support/InMemoryTaskRepository';

type Adapter = 'in-memory' | 'obsidian';

interface ContractHarness {
  readonly repository: TaskRepository;
  readonly snapshots: (content: string) => readonly TaskSnapshot[];
  readonly read: () => Promise<string>;
}

async function makeHarness(adapter: Adapter, source: string): Promise<ContractHarness> {
  const path = 'tasks.md';
  const app = await createAppWithFiles({ [path]: source });
  const statusCatalog = new StatusCatalog(toStatusRules(DEFAULT_SETTINGS.taskStatuses));
  const codec = new TaskMarkdownCodec(statusCatalog);
  const index = new TaskIndex(app, {
    statusCatalog,
    dailyNoteFormat: DEFAULT_SETTINGS.desktop.dailyNoteFormat,
  });
  const snapshots = (content: string) => index.snapshotsFromContent(path, content);
  if (adapter === 'in-memory') {
    const repository = new InMemoryTaskRepository({
      files: { [path]: source },
      codec,
      snapshotsFromContent: (_path, content) => snapshots(content),
    });
    return {
      repository,
      snapshots,
      read: async () => repository.content(path) ?? '',
    };
  }
  const repository = new ObsidianTaskRepository(app, {
    codec,
    editor: new TaskBlockEditor(),
    locator: new TaskLocator(),
    snapshotsFromContent: (_path, content) => snapshots(content),
  });
  return {
    repository,
    snapshots,
    read: async () => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return '';
      return app.vault.cachedRead(file);
    },
  };
}

function rootRef(harness: ContractHarness, source: string): TaskRef {
  return harness.snapshots(source)[0]!.ref;
}

for (const adapter of ['in-memory', 'obsidian'] as const) {
  describe(`${adapter} TaskRepository shared contract`, () => {
    it('returns a detached no-op success', async () => {
      const source = '- [ ] task 📅 2026-07-20\n';
      const h = await makeHarness(adapter, source);
      const result = await h.repository.edit({
        type: 'patch',
        target: { type: 'task', ref: rootRef(h, source) },
        patch: { due: { type: 'set', value: localDate('2026-07-20') } },
      });
      expect(result).toMatchObject({ type: 'committed', changed: false });
      expect(await h.read()).toBe(source);
      if (result.type === 'committed' && result.outcome.type === 'task') {
        (result.outcome.task.planning as { due?: string }).due = '1900-01-01';
      }
      expect(h.snapshots(await h.read())[0]!.planning.due).toBe('2026-07-20');
    });

    it('uses scheduled-before-due reschedule semantics', async () => {
      const source = '- [ ] task ⏳ 2026-07-10 📅 2026-07-20\n';
      const h = await makeHarness(adapter, source);
      await h.repository.edit({
        type: 'reschedule',
        ref: rootRef(h, source),
        date: localDate('2026-07-11'),
      });
      expect(await h.read()).toContain('⏳ 2026-07-11 📅 2026-07-20');
    });

    it('returns invalid without changing an inverted span', async () => {
      const source = '- [ ] task 🛫 2026-07-10 📅 2026-07-20\n';
      const h = await makeHarness(adapter, source);
      await expect(
        h.repository.edit({
          type: 'patch',
          target: { type: 'task', ref: rootRef(h, source) },
          patch: { start: { type: 'set', value: localDate('2026-07-21') } },
        }),
      ).resolves.toMatchObject({ type: 'invalid' });
      expect(await h.read()).toBe(source);
    });

    it('rejects a stale child exact block without same-line adoption', async () => {
      const source = '- [ ] root\n  - [ ] child\n';
      const h = await makeHarness(adapter, source);
      const root = h.snapshots(source)[0]!;
      const child = root.subtasks[0]!;
      await expect(
        h.repository.edit({
          type: 'patch',
          target: {
            type: 'subtask',
            ref: { ...child.ref, originalBlock: '  - [ ] replacement' },
          },
          patch: { due: { type: 'set', value: localDate('2026-07-20') } },
        }),
      ).resolves.toMatchObject({ type: 'conflict' });
      expect(await h.read()).toBe(source);
    });
  });
}
