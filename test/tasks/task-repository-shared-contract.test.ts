import { TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings/defaults';
import { toStatusRules } from '../../src/settings/statusCatalogAdapter';
import type { TaskRepository } from '../../src/tasks/application/TaskRepository';
import { StatusCatalog } from '../../src/tasks/domain/StatusCatalog';
import type { TaskRef, TaskSnapshot } from '../../src/tasks/domain/types';
import { durationMinutes, localDate, localTime } from '../../src/tasks/domain/validation';
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
    it('replaces and appends root and nested Markdown titles losslessly', async () => {
      const source =
        '> - [ ] Old [[Root]] #tag 🧭 opaque 🆔 keep-id ⛔ dep ^block\r\n>   - [ ] Old [[Child]] #child custom\r\n';
      const h = await makeHarness(adapter, source);
      const root = h.snapshots(source)[0]!;
      await expect(
        h.repository.edit({
          type: 'patch',
          target: { type: 'task', ref: root.ref },
          patch: { markdownTitle: { type: 'set', value: 'New [root](https://root.test)' } },
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect(await h.read()).toBe(
        '> - [ ] New [root](https://root.test) #tag 🧭 opaque 🆔 keep-id ⛔ dep ^block\r\n>   - [ ] Old [[Child]] #child custom\r\n',
      );

      const changed = await h.read();
      const child = h.snapshots(changed)[0]!.subtasks[0]!;
      await expect(
        h.repository.edit({
          type: 'append-title',
          target: { type: 'subtask', ref: child.ref },
          markdown: '[[attachment.png|image]]',
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect(await h.read()).toContain(
        '>   - [ ] Old [[Child]] #child custom [[attachment.png|image]]\r\n',
      );
    });

    it('edits links only inside the confirmed title, description, or revisioned comment target', async () => {
      const source =
        '- [ ] [[TitleA|same]] and [[TitleB|same]] #tag 🆔 keep ⛔ dep ^block\r\n' +
        '  - > desc [[DescA|same]] and [[DescB|same]]\r\n' +
        '  - 2026-07-14: comment [[CommentA|same]] and [[CommentB|same]]\r\n';
      const h = await makeHarness(adapter, source);

      let root = h.snapshots(source)[0]!;
      await expect(
        h.repository.edit({
          type: 'edit-link',
          target: { type: 'title', target: { type: 'task', ref: root.ref } },
          occurrence: 1,
          replacement: '[[TitleChanged|updated]]',
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });

      let content = await h.read();
      root = h.snapshots(content)[0]!;
      await expect(
        h.repository.edit({
          type: 'edit-link',
          target: { type: 'description', target: { type: 'task', ref: root.ref } },
          occurrence: 1,
          replacement: '[updated](https://description.test)',
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });

      content = await h.read();
      root = h.snapshots(content)[0]!;
      await expect(
        h.repository.edit({
          type: 'edit-link',
          target: { type: 'comment', ref: root.comments[0]!.ref },
          occurrence: 1,
          replacement: '[[CommentChanged]]',
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });

      expect(await h.read()).toBe(
        '- [ ] [[TitleA|same]] and [[TitleChanged|updated]] #tag 🆔 keep ⛔ dep ^block\r\n' +
          '  - > desc [[DescA|same]] and [updated](https://description.test)\r\n' +
          '  - 2026-07-14: comment [[CommentA|same]] and [[CommentChanged]]\r\n',
      );
    });

    it('ignores inline-code lookalikes when editing root and nested text targets', async () => {
      const source =
        '- [ ] `[[Same]]` [[Same]]\r\n' +
        '  - > desc `[Same](Same)` [Same](Same)\r\n' +
        '  - 2026-07-14: comment `[[Same]]` [[Same]]\r\n' +
        '  - [ ] child `[[Same]]` [[Same]]\r\n';
      const h = await makeHarness(adapter, source);

      let root = h.snapshots(source)[0]!;
      await expect(
        h.repository.edit({
          type: 'edit-link',
          target: { type: 'title', target: { type: 'task', ref: root.ref } },
          occurrence: 0,
          replacement: '[[RootChanged]]',
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });

      let content = await h.read();
      root = h.snapshots(content)[0]!;
      await expect(
        h.repository.edit({
          type: 'edit-link',
          target: { type: 'description', target: { type: 'task', ref: root.ref } },
          occurrence: 0,
          replacement: '[DescriptionChanged](DescriptionChanged)',
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });

      content = await h.read();
      root = h.snapshots(content)[0]!;
      await expect(
        h.repository.edit({
          type: 'edit-link',
          target: { type: 'comment', ref: root.comments[0]!.ref },
          occurrence: 0,
          replacement: '[[CommentChanged]]',
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });

      content = await h.read();
      root = h.snapshots(content)[0]!;
      await expect(
        h.repository.edit({
          type: 'edit-link',
          target: { type: 'title', target: { type: 'subtask', ref: root.subtasks[0]!.ref } },
          occurrence: 0,
          replacement: '[[ChildChanged]]',
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });

      expect(await h.read()).toBe(
        '- [ ] `[[Same]]` [[RootChanged]]\r\n' +
          '  - > desc `[Same](Same)` [DescriptionChanged](DescriptionChanged)\r\n' +
          '  - 2026-07-14: comment `[[Same]]` [[CommentChanged]]\r\n' +
          '  - [ ] child `[[Same]]` [[ChildChanged]]\r\n',
      );
    });

    it('rejects stale comments and absent target-scoped occurrences without changing bytes', async () => {
      const source = '- [ ] root [[Title]]\n  - 2026-07-14: comment [[Comment]]\n';
      const h = await makeHarness(adapter, source);
      const root = h.snapshots(source)[0]!;

      await expect(
        h.repository.edit({
          type: 'edit-link',
          target: {
            type: 'comment',
            ref: { ...root.comments[0]!.ref, originalMarkdown: '  - stale [[Comment]]' },
          },
          occurrence: 0,
          replacement: '[[Changed]]',
        }),
      ).resolves.toMatchObject({ type: 'conflict' });
      await expect(
        h.repository.edit({
          type: 'edit-link',
          target: { type: 'title', target: { type: 'task', ref: root.ref } },
          occurrence: 1,
          replacement: '[[Changed]]',
        }),
      ).resolves.toEqual({
        type: 'invalid',
        issues: [{ code: 'invalid-target', field: 'link' }],
      });
      expect(await h.read()).toBe(source);
    });

    it('rejects multiline title and link inputs without changing bytes', async () => {
      const source =
        '- [ ] root [[Title]]\r\n' +
        '  - > desc [[Description]]\r\n' +
        '  - 2026-07-14: comment [[Comment]]\r\n';
      const h = await makeHarness(adapter, source);

      const commands = () => {
        const root = h.snapshots(source)[0]!;
        return [
          {
            type: 'patch' as const,
            target: { type: 'task' as const, ref: root.ref },
            patch: { markdownTitle: { type: 'set' as const, value: 'changed\n- [ ] injected' } },
          },
          {
            type: 'append-title' as const,
            target: { type: 'task' as const, ref: root.ref },
            markdown: 'later\rinjected',
          },
          {
            type: 'edit-link' as const,
            target: { type: 'title' as const, target: { type: 'task' as const, ref: root.ref } },
            occurrence: 0,
            replacement: '[[Changed]]\n- [ ] injected',
          },
          {
            type: 'edit-link' as const,
            target: {
              type: 'description' as const,
              target: { type: 'task' as const, ref: root.ref },
            },
            occurrence: 0,
            replacement: '[[Changed]]\rinjected',
          },
          {
            type: 'edit-link' as const,
            target: { type: 'comment' as const, ref: root.comments[0]!.ref },
            occurrence: 0,
            replacement: '[[Changed]]\n- injected',
          },
        ];
      };

      for (const command of commands()) {
        await expect(h.repository.edit(command)).resolves.toMatchObject({
          type: 'invalid',
          issues: [{ code: 'invalid-target' }],
        });
        expect(await h.read()).toBe(source);
      }
    });

    it('rebases an ambiguous revisioned comment target onto every candidate root', async () => {
      const block = '- [ ] duplicate\n  - comment [[Link]]';
      const source = `${block}\n${block}\n`;
      const h = await makeHarness(adapter, source);
      const revision = h.snapshots(source)[0]!.ref.revision;
      const parentRef = { filePath: 'tasks.md', line: 9, revision };
      const result = await h.repository.edit({
        type: 'edit-link',
        target: {
          type: 'comment',
          ref: {
            parent: { type: 'task', ref: parentRef },
            relativeLine: 1,
            originalMarkdown: '  - comment [[Link]]',
          },
        },
        occurrence: 0,
        replacement: '[[Changed]]',
      });

      expect(result).toMatchObject({
        type: 'ambiguous',
        candidates: [
          { target: { type: 'comment', ref: { parent: { ref: { line: 0 } } } } },
          { target: { type: 'comment', ref: { parent: { ref: { line: 2 } } } } },
        ],
      });
      expect(await h.read()).toBe(source);
    });

    it('applies status stamps and reopening losslessly', async () => {
      const source = '- [ ] task 🆔 keep-id ⛔ dep ^block\r\n';
      const h = await makeHarness(adapter, source);
      await expect(
        h.repository.edit({
          type: 'set-status',
          target: { type: 'task', ref: rootRef(h, source) },
          symbol: 'x',
          stamp: localDate('2026-07-14'),
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect(await h.read()).toBe('- [x] task 🆔 keep-id ⛔ dep ✅ 2026-07-14 ^block\r\n');

      const changed = await h.read();
      await h.repository.edit({
        type: 'set-status',
        target: { type: 'task', ref: rootRef(h, changed) },
        symbol: ' ',
      });
      expect(await h.read()).toBe(source);
    });

    it.each([
      ['A', '🔺'],
      ['B', '⏫'],
      ['C', '🔼'],
      ['D', ''],
      ['E', '🔽'],
      ['F', '⏬'],
    ] as const)(
      'applies priority %s without touching unrelated spans',
      async (priority, marker) => {
        const source = '- [ ] task #tag 🆔 keep-id ⛔ dep ^block\n';
        const h = await makeHarness(adapter, source);
        await expect(
          h.repository.edit({
            type: 'patch',
            target: { type: 'task', ref: rootRef(h, source) },
            patch: { priority: { type: 'set', value: priority } },
          }),
        ).resolves.toMatchObject({
          type: 'committed',
          changed: priority !== 'D',
        });
        const content = await h.read();
        expect(content).toContain('#tag');
        expect(content).toContain('🆔 keep-id ⛔ dep');
        expect(content).toContain('^block');
        if (marker) expect(content).toContain(marker);
      },
    );

    it('applies status and priority to an exactly referenced nested task', async () => {
      const source = '- [ ] root\n  - [ ] child\n    - [ ] nested\n';
      const h = await makeHarness(adapter, source);
      const nested = h.snapshots(source)[0]!.subtasks[0]!.subtasks[0]!;
      await h.repository.edit({
        type: 'set-status',
        target: { type: 'subtask', ref: nested.ref },
        symbol: 'x',
        stamp: localDate('2026-07-14'),
      });
      const changed = await h.read();
      const changedNested = h.snapshots(changed)[0]!.subtasks[0]!.subtasks[0]!;
      await h.repository.edit({
        type: 'patch',
        target: { type: 'subtask', ref: changedNested.ref },
        patch: { priority: { type: 'set', value: 'F' } },
      });
      expect(await h.read()).toContain('    - [x] nested ⏬ ✅ 2026-07-14');

      const prioritized = await h.read();
      const prioritizedNested = h.snapshots(prioritized)[0]!.subtasks[0]!.subtasks[0]!;
      await h.repository.edit({
        type: 'set-status',
        target: { type: 'subtask', ref: prioritizedNested.ref },
        symbol: '-',
        stamp: localDate('2026-07-15'),
      });
      expect(await h.read()).toContain('    - [-] nested ⏬ ❌ 2026-07-15');
      expect(await h.read()).not.toContain('✅ 2026-07-14');

      const cancelled = await h.read();
      const cancelledNested = h.snapshots(cancelled)[0]!.subtasks[0]!.subtasks[0]!;
      await h.repository.edit({
        type: 'set-status',
        target: { type: 'subtask', ref: cancelledNested.ref },
        symbol: ' ',
      });
      expect(await h.read()).toContain('    - [ ] nested ⏬');
      expect(await h.read()).not.toMatch(/[✅❌]/u);
    });

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

    it('applies valid multi-field and clear/set span patches atomically', async () => {
      const forward = '- [ ] task 🛫 2026-07-01 📅 2026-07-10\n';
      const forwardHarness = await makeHarness(adapter, forward);
      await expect(
        forwardHarness.repository.edit({
          type: 'patch',
          target: { type: 'task', ref: rootRef(forwardHarness, forward) },
          patch: {
            start: { type: 'set', value: localDate('2026-07-20') },
            due: { type: 'set', value: localDate('2026-07-30') },
          },
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect(await forwardHarness.read()).toContain('🛫 2026-07-20 📅 2026-07-30');

      const clearStart = '- [ ] task 🛫 2026-07-10 📅 2026-07-20\n';
      const clearStartHarness = await makeHarness(adapter, clearStart);
      await expect(
        clearStartHarness.repository.edit({
          type: 'patch',
          target: { type: 'task', ref: rootRef(clearStartHarness, clearStart) },
          patch: {
            start: { type: 'clear' },
            due: { type: 'set', value: localDate('2026-07-05') },
          },
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect(await clearStartHarness.read()).toContain('📅 2026-07-05');
      expect(await clearStartHarness.read()).not.toContain('🛫');

      const clearDue = '- [ ] task 🛫 2026-07-10 📅 2026-07-20\n';
      const clearDueHarness = await makeHarness(adapter, clearDue);
      await expect(
        clearDueHarness.repository.edit({
          type: 'patch',
          target: { type: 'task', ref: rootRef(clearDueHarness, clearDue) },
          patch: {
            start: { type: 'set', value: localDate('2026-07-30') },
            due: { type: 'clear' },
          },
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect(await clearDueHarness.read()).toContain('🛫 2026-07-30');
      expect(await clearDueHarness.read()).not.toContain('📅');
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

    it('sets and clears independent time and duration fields losslessly', async () => {
      const source = '- [ ] task custom 🆔 keep-id ⛔ dep ^block\r\n';
      const h = await makeHarness(adapter, source);
      const ref = rootRef(h, source);
      const set = await h.repository.edit({
        type: 'patch',
        target: { type: 'task', ref },
        patch: {
          time: { type: 'set', value: localTime('09:30') },
          duration: { type: 'set', value: durationMinutes(90) },
        },
      });
      expect(set).toMatchObject({
        type: 'committed',
        changed: true,
        outcome: { type: 'task', task: { planning: { time: '09:30', duration: 90 } } },
      });
      expect(await h.read()).toBe(
        '- [ ] task custom 🆔 keep-id ⛔ dep ⏰ 09:30 ⏱️ 1h30m ^block\r\n',
      );

      const changed = await h.read();
      const cleared = await h.repository.edit({
        type: 'patch',
        target: { type: 'task', ref: rootRef(h, changed) },
        patch: { time: { type: 'clear' }, duration: { type: 'clear' } },
      });
      expect(cleared).toMatchObject({ type: 'committed', changed: true });
      expect(await h.read()).toBe(source);
    });

    it('sets a time slot atomically and preserves duration when omitted', async () => {
      const source = '- [ ] task ⏳ 2026-07-10 ⏰ 08:00 ⏱️ 2h custom\n';
      const h = await makeHarness(adapter, source);
      const result = await h.repository.edit({
        type: 'set-time-slot',
        ref: rootRef(h, source),
        date: localDate('2026-07-11'),
        time: localTime('09:30'),
      });
      expect(result).toMatchObject({
        type: 'committed',
        changed: true,
        outcome: {
          type: 'task',
          task: { planning: { scheduled: '2026-07-11', time: '09:30', duration: 120 } },
        },
      });
      expect(await h.read()).toContain('⏳ 2026-07-11 ⏰ 09:30 ⏱️ 2h custom');
    });

    it('sets an explicit slot duration in the same transaction', async () => {
      const source = '- [ ] task 📅 2026-07-10 ⏰ 08:00 ⏱️ 2h\n';
      const h = await makeHarness(adapter, source);
      await expect(
        h.repository.edit({
          type: 'set-time-slot',
          ref: rootRef(h, source),
          date: localDate('2026-07-12'),
          time: localTime('10:15'),
          duration: durationMinutes(45),
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect(await h.read()).toContain('📅 2026-07-12 ⏰ 10:15 ⏱️ 45m');
    });

    it('converts a timed task to all-day atomically', async () => {
      const source = '- [ ] task 📅 2026-07-10 ⏰ 08:00 ⏱️ 2h custom\n';
      const h = await makeHarness(adapter, source);
      const result = await h.repository.edit({
        type: 'convert-to-all-day',
        ref: rootRef(h, source),
        date: localDate('2026-07-12'),
      });
      expect(result).toMatchObject({
        type: 'committed',
        changed: true,
        outcome: { type: 'task', task: { planning: { due: '2026-07-12' } } },
      });
      expect(await h.read()).toBe('- [ ] task 📅 2026-07-12 custom\n');
    });

    it.each([
      ['start', '2026-07-09', '🛫 2026-07-09 📅 2026-07-20'],
      ['due', '2026-07-21', '🛫 2026-07-10 📅 2026-07-21'],
    ] as const)('sets the %s span boundary', async (boundary, date, expected) => {
      const source = '- [ ] task 🛫 2026-07-10 📅 2026-07-20\n';
      const h = await makeHarness(adapter, source);
      await expect(
        h.repository.edit({
          type: 'set-span-boundary',
          ref: rootRef(h, source),
          boundary,
          date: localDate(date),
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect(await h.read()).toContain(expected);
    });

    it('rejects an inverted semantic boundary without changing bytes', async () => {
      const source = '- [ ] task 🛫 2026-07-10 📅 2026-07-20\n';
      const h = await makeHarness(adapter, source);
      await expect(
        h.repository.edit({
          type: 'set-span-boundary',
          ref: rootRef(h, source),
          boundary: 'start',
          date: localDate('2026-07-21'),
        }),
      ).resolves.toEqual({
        type: 'invalid',
        issues: [{ code: 'inverted-span', field: 'start,due' }],
      });
      expect(await h.read()).toBe(source);
    });

    it.each([
      {
        label: 'due-anchored reschedule',
        source: '- [ ] task 🛫 2026-07-21 📅 2026-07-20 ⏰ 09:00 ⏱️ 1h\n',
        command: { type: 'reschedule' as const, date: localDate('2026-07-20') },
      },
      {
        label: 'due-anchored time slot',
        source: '- [ ] task 🛫 2026-07-21 📅 2026-07-20 ⏰ 09:00 ⏱️ 1h\n',
        command: {
          type: 'set-time-slot' as const,
          date: localDate('2026-07-20'),
          time: localTime('10:00'),
        },
      },
      {
        label: 'due-anchored all-day conversion',
        source: '- [ ] task 🛫 2026-07-21 📅 2026-07-20 ⏰ 09:00 ⏱️ 1h\n',
        command: { type: 'convert-to-all-day' as const, date: localDate('2026-07-20') },
      },
      {
        label: 'scheduled-anchored reschedule',
        source: '- [ ] task 🛫 2026-07-21 ⏳ 2026-07-19 📅 2026-07-20 ⏰ 09:00 ⏱️ 1h\n',
        command: { type: 'reschedule' as const, date: localDate('2026-07-19') },
      },
      {
        label: 'scheduled-anchored time slot',
        source: '- [ ] task 🛫 2026-07-21 ⏳ 2026-07-19 📅 2026-07-20 ⏰ 09:00 ⏱️ 1h\n',
        command: {
          type: 'set-time-slot' as const,
          date: localDate('2026-07-19'),
          time: localTime('10:00'),
        },
      },
      {
        label: 'scheduled-anchored all-day conversion',
        source: '- [ ] task 🛫 2026-07-21 ⏳ 2026-07-19 📅 2026-07-20 ⏰ 09:00 ⏱️ 1h\n',
        command: { type: 'convert-to-all-day' as const, date: localDate('2026-07-19') },
      },
    ])(
      'rejects $label when the semantic scheduling command uses an inverted span',
      async ({ source, command }) => {
        const h = await makeHarness(adapter, source);
        const result = await h.repository.edit({ ...command, ref: rootRef(h, source) });

        expect(result).toEqual({
          type: 'invalid',
          issues: [{ code: 'inverted-span', field: 'start,due' }],
        });
        expect(await h.read()).toBe(source);
      },
    );

    it('creates and re-extends a span without duplicating start', async () => {
      const source = '- [ ] task ⏳ 2026-07-10 custom\n';
      const h = await makeHarness(adapter, source);
      await expect(
        h.repository.edit({
          type: 'extend-span',
          ref: rootRef(h, source),
          due: localDate('2026-07-12'),
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect(await h.read()).toContain('🛫 2026-07-10 ⏳ 2026-07-10');
      expect(await h.read()).toContain('📅 2026-07-12');

      const changed = await h.read();
      await expect(
        h.repository.edit({
          type: 'extend-span',
          ref: rootRef(h, changed),
          due: localDate('2026-07-14'),
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: true });
      expect((await h.read()).match(/🛫/gu)).toHaveLength(1);
      expect(await h.read()).toContain('🛫 2026-07-10 ⏳ 2026-07-10');
      expect(await h.read()).toContain('📅 2026-07-14');
    });

    it('rejects extending a task without a planning anchor', async () => {
      const source = '- [ ] task without dates\n';
      const h = await makeHarness(adapter, source);

      await expect(
        h.repository.edit({
          type: 'extend-span',
          ref: rootRef(h, source),
          due: localDate('2026-07-14'),
        }),
      ).resolves.toEqual({
        type: 'invalid',
        issues: [{ code: 'invalid-target', field: 'span-anchor' }],
      });
      expect(await h.read()).toBe(source);
    });

    it('rejects a runtime-injected subtask duration patch', async () => {
      const source = '- [ ] root\n  - [ ] child\n';
      const h = await makeHarness(adapter, source);
      const child = h.snapshots(source)[0]!.subtasks[0]!;

      await expect(
        h.repository.edit({
          type: 'patch',
          target: { type: 'subtask', ref: child.ref },
          patch: { duration: { type: 'set', value: durationMinutes(30) } },
        } as never),
      ).resolves.toEqual({
        type: 'invalid',
        issues: [{ code: 'invalid-target', field: 'duration' }],
      });
      expect(await h.read()).toBe(source);
    });

    it('returns a detached no-op for an unchanged time/span command', async () => {
      const source = '- [ ] task 🛫 2026-07-10 📅 2026-07-20 ⏰ 09:30\n';
      const h = await makeHarness(adapter, source);
      await expect(
        h.repository.edit({
          type: 'set-time-slot',
          ref: rootRef(h, source),
          date: localDate('2026-07-20'),
          time: localTime('09:30'),
        }),
      ).resolves.toMatchObject({ type: 'committed', changed: false });
      expect(await h.read()).toBe(source);
    });

    it('rejects runtime-invalid time and duration values without changing bytes', async () => {
      const source = '- [ ] task 📅 2026-07-20\n';
      const h = await makeHarness(adapter, source);
      await expect(
        h.repository.edit({
          type: 'patch',
          target: { type: 'task', ref: rootRef(h, source) },
          patch: { time: { type: 'set', value: '25:00' as never } },
        }),
      ).resolves.toMatchObject({ type: 'invalid', issues: [{ code: 'invalid-time' }] });
      await expect(
        h.repository.edit({
          type: 'patch',
          target: { type: 'task', ref: rootRef(h, source) },
          patch: { duration: { type: 'set', value: 0 as never } },
        }),
      ).resolves.toMatchObject({ type: 'invalid', issues: [{ code: 'invalid-duration' }] });
      expect(await h.read()).toBe(source);
    });
  });
}
