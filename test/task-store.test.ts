import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import {
  configuredTaskStore,
  createAppWithFiles,
  readStoreTasks,
  seedTaskCache,
  useRealMoment,
} from './helpers';

useRealMoment();

describe('TaskStore toggleTask', () => {
  it('toggles open to done, appends ✅ today, strips old ✅', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task 📅 2026-06-24 ✅ 2026-01-01' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = configuredTaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(readStoreTasks(store)[0]!);
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toMatch(/^- \[x\] task 📅 2026-06-24 ✅ \d{4}-\d{2}-\d{2}$/);
    expect(content).not.toContain('2026-01-01');
  });

  it('toggles open (no ✅) to done, appends ✅ today', async () => {
    const today = window.moment().format('YYYY-MM-DD');
    const app = await createAppWithFiles({ 't.md': `- [ ] task 📅 ${today}` });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = configuredTaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(readStoreTasks(store)[0]!);
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe(`- [x] task 📅 ${today} ✅ ${today}`);
  });

  it('toggles a blockquote task and preserves the "> " prefix', async () => {
    const today = window.moment().format('YYYY-MM-DD');
    const app = await createAppWithFiles({ 't.md': '> - [ ] quoted task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = configuredTaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(readStoreTasks(store)[0]!);
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe(`> - [x] quoted task ✅ ${today}`);
  });

  it('toggles done to open, strips ✅ date', async () => {
    const app = await createAppWithFiles({ 't.md': '- [x] task ✅ 2026-06-22' });
    seedTaskCache(app, 't.md', [{ task: 'x', parent: -1, line: 0 }]);
    const store = configuredTaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(readStoreTasks(store)[0]!);
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe('- [ ] task');
  });

  it('toggles a [-] cancelled line to done (registry-driven, resolves FU-11)', async () => {
    const today = window.moment().format('YYYY-MM-DD');
    const app = await createAppWithFiles({ 't.md': '- [-] cancelled task' });
    seedTaskCache(app, 't.md', [{ task: '-', parent: -1, line: 0 }]);
    const store = configuredTaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await store.toggleTask(readStoreTasks(store)[0]!);
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toBe(`- [x] cancelled task ✅ ${today}`);
  });

  it('out-of-bounds task.line falls back to rawText scan and toggles the task', async () => {
    // The mutation service uses rawText as a fingerprint: even if the line hint (999) is wrong,
    // findTaskLine scans all lines and finds the unique match at line 0, so the toggle succeeds.
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = configuredTaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const task = readStoreTasks(store)[0]!;
    await store.toggleTask({ ...task, line: 999 });
    const content = await app.vault.cachedRead(app.vault.getMarkdownFiles()[0]!);
    expect(content).toContain('- [x] task');
  });
});

describe('TaskStore destroy', () => {
  it('destroy is idempotent (calling twice does not throw)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] x' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }]);
    const store = configuredTaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    store.destroy();
    expect(() => store.destroy()).not.toThrow();
  });
});
