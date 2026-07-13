import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { TaskStore } from '../src/store/TaskStore';
import { createAppWithFiles, readStoreTasks, seedTaskCache, useRealMoment } from './helpers';

useRealMoment();

describe('TaskStore command edge cases', () => {
  it('sets a configured in-progress status symbol', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.setTaskStatus(readStoreTasks(store)[0]!, '/');
    expect(await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!)).toContain('- [/] task');
    store.destroy();
  });

  it('sets and clears priority through repeated commands', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const target = readStoreTasks(store)[0]!;
    await store.setPriority(target, 'A');
    await store.setPriority({ ...target, rawText: '- [ ] task 🔺' }, 'D');
    expect(await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!)).toBe('- [ ] task');
    store.destroy();
  });

  it('rebuilds status command semantics after settings mutation', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const app = await createAppWithFiles({});
    const store = new TaskStore(app, settings);
    settings.taskStatuses = settings.taskStatuses.map((status) =>
      status.type === 'done' ? { ...status, symbol: 'X' } : status,
    );
    store.rebuildStatusRegistry();
    expect(store.statusRegistry.defaultDone().symbol).toBe('X');
    store.destroy();
  });
});
