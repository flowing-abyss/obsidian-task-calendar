import { TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { TaskStore } from '../src/store/TaskStore';
import { createAppWithFiles, flushMicrotasks, seedTaskCache, useRealMoment } from './helpers';

useRealMoment();

function mdFile(app: Awaited<ReturnType<typeof createAppWithFiles>>, path: string): TFile {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`File not found: ${path}`);
  return f;
}

describe('TaskStore deep — frontmatter edge cases', () => {
  it('frontmatter color is not a string → undefined (L80, L147)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    // seedTaskCache accepts frontmatter with non-string color
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }], {
      color: 123 as unknown as string,
      textColor: null as unknown as string,
      icon: undefined,
    });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await flushMicrotasks(20);
    const task = store.getTasks()[0]!;
    expect(task.noteColor).toBeUndefined();
    expect(task.noteTextColor).toBeUndefined();
    expect(task.noteIcon).toBeUndefined();
  });

  it('frontmatter icon is a number → undefined (L148)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }], {
      icon: 42 as unknown as string,
    });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await flushMicrotasks(20);
    const task = store.getTasks()[0]!;
    expect(task.noteIcon).toBeUndefined();
  });

  it('frontmatter with valid string values → preserved', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] task' });
    seedTaskCache(app, 't.md', [{ task: ' ', parent: -1, line: 0 }], {
      color: '#abc',
      textColor: '#def',
      icon: '⭐',
    });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await flushMicrotasks(20);
    const task = store.getTasks()[0]!;
    expect(task.noteColor).toBe('#abc');
    expect(task.noteTextColor).toBe('#def');
    expect(task.noteIcon).toBe('⭐');
  });
});

describe('TaskStore deep — rename handler', () => {
  it('rename of non-md file does not notify (L159)', async () => {
    const app = await createAppWithFiles({ 'data.json': '{}' });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = app.vault.getAbstractFileByPath('data.json')!;
    await app.vault.rename(file, 'data2.json');
    await flushMicrotasks(20);
    expect(events).toHaveLength(0);
  });

  it('rename of md file with no tasks → no taskMap update, notifies (L160-161)', async () => {
    const app = await createAppWithFiles({ 'empty.md': 'no tasks here' });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = mdFile(app, 'empty.md');
    await app.vault.rename(file, 'empty2.md');
    await flushMicrotasks(20);
    // Rename of md file always notifies even if no tasks (CURRENT BEHAVIOR, FU-13)
    expect(events).toContain('empty2.md');
    expect(store.getTasks()).toHaveLength(0);
  });

  it('rename of md file with tasks but no frontmatter → frontmatter branch skipped (L166-168)', async () => {
    const app = await createAppWithFiles({ 'old.md': '- [ ] task' });
    seedTaskCache(app, 'old.md', [{ task: ' ', parent: -1, line: 0 }]);
    // No frontmatter seeded → frontmatterMap has no entry for 'old.md'
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const file = mdFile(app, 'old.md');
    await app.vault.rename(file, 'new.md');
    await flushMicrotasks(20);
    const tasks = store.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.filePath).toBe('new.md');
    // No frontmatter to move, but task is updated
  });
});

describe('TaskStore deep — delete handler', () => {
  it('delete of non-md file does not notify (L176)', async () => {
    const app = await createAppWithFiles({ 'data.json': '{}' });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = app.vault.getAbstractFileByPath('data.json')!;
    await app.vault.delete(file);
    await flushMicrotasks(20);
    expect(events).toHaveLength(0);
  });

  it('delete of md file with no tasks → taskMap.delete returns false, no notify (L177)', async () => {
    const app = await createAppWithFiles({ 'empty.md': 'no tasks' });
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    const events: string[] = [];
    store.onUpdate((e) => events.push(e.changedFile ?? 'bulk'));
    const file = mdFile(app, 'empty.md');
    await app.vault.delete(file);
    await flushMicrotasks(20);
    expect(events).toHaveLength(0);
  });
});

describe('TaskStore deep — parseFileTasks edge cases', () => {
  it('listItem with task===undefined is skipped (L107)', async () => {
    const app = await createAppWithFiles({ 't.md': '- regular list item' });
    // listItem without task field → skipped
    seedTaskCache(app, 't.md', [{ task: undefined as unknown as string, parent: -1, line: 0 }]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await flushMicrotasks(20);
    expect(store.getTasks()).toHaveLength(0);
  });

  it('listItem with parent >= 0 is skipped as child (L112)', async () => {
    const app = await createAppWithFiles({ 't.md': '- [ ] parent\n  - [ ] child' });
    seedTaskCache(app, 't.md', [
      { task: ' ', parent: -1, line: 0 },
      { task: ' ', parent: 0, line: 1 }, // child, parent >= 0 → skipped
    ]);
    const store = new TaskStore(app, DEFAULT_SETTINGS);
    await store.initialize();
    await flushMicrotasks(20);
    // Only root task parsed; child parsed via parseSubItems internally
    const tasks = store.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.subtasks).toHaveLength(1);
  });
});
