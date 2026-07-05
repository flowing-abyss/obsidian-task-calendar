// test/tag-manager-files.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { TagManager } from '../src/tags/TagManager';
import { createAppWithFiles } from './helpers';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    filePath: 'notes/tasks.md',
    line: 0,
    rawText: '- [ ] do thing #task/inbox',
    text: 'do thing #task/inbox',
    markdownText: 'do thing #task/inbox',
    status: 'open',
    statusSymbol: ' ',
    priority: 'D',
    ...overrides,
  };
}

async function makeManager(files: Record<string, string> = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    pinnedTags: [...DEFAULT_SETTINGS.pinnedTags],
    archivedTags: [...DEFAULT_SETTINGS.archivedTags],
  };
  const save = vi.fn().mockResolvedValue(undefined);
  const app = await createAppWithFiles(files);
  const tm = new TagManager(app, settings, save);
  return { tm, app, settings, save };
}

describe('TagManager.addTagToTask', () => {
  it('appends tag to the task line', async () => {
    const content = '- [ ] do thing #task/inbox\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    const task = makeTask({ line: 0 });
    await tm.addTagToTask(task, '#task/next');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).toContain('#task/next');
  });

  it('does not duplicate tag if already present', async () => {
    const content = '- [ ] do thing #task/inbox #task/next\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    const task = makeTask({ line: 0, rawText: content.trim() });
    await tm.addTagToTask(task, '#task/next');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    // Should only have one occurrence
    expect(updated.split('#task/next').length - 1).toBe(1);
  });

  it('no-ops if file does not exist', async () => {
    const { tm } = await makeManager({});
    const task = makeTask({ filePath: 'nonexistent.md' });
    await expect(tm.addTagToTask(task, '#task/next')).resolves.toBeUndefined();
  });
});

describe('TagManager.removeTagFromTask', () => {
  it('removes tag from task line', async () => {
    const content = '- [ ] do thing #task/inbox #task/next\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    const task = makeTask({ line: 0, rawText: content.trim() });
    await tm.removeTagFromTask(task, '#task/next');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).not.toContain('#task/next');
  });

  it('does not remove tag with longer suffix (#task/next-action preserved when removing #task/next)', async () => {
    const content = '- [ ] do thing #task/next-action\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    const task = makeTask({ line: 0, rawText: content.trim() });
    await tm.removeTagFromTask(task, '#task/next');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).toContain('#task/next-action');
  });
});

describe('TagManager.toggleTagOnTask', () => {
  it('adds tag when not present', async () => {
    const content = '- [ ] do thing\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    const task = makeTask({ line: 0, rawText: '- [ ] do thing' });
    await tm.toggleTagOnTask(task, '#task/next');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).toContain('#task/next');
  });

  it('removes tag when present', async () => {
    const content = '- [ ] do thing #task/next\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    const task = makeTask({ line: 0, rawText: '- [ ] do thing #task/next' });
    await tm.toggleTagOnTask(task, '#task/next');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).not.toContain('#task/next');
  });
});

describe('TagManager.assignTagFromInbox', () => {
  it('adds tag and removes inbox tag when removeTagOnAssign=true', async () => {
    const content = '- [ ] do thing #task/inbox\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    const task = makeTask({ line: 0, rawText: '- [ ] do thing #task/inbox' });
    await tm.assignTagFromInbox(task, '#task/next');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).toContain('#task/next');
    expect(updated).not.toContain('#task/inbox');
  });

  it('adds tag but keeps inbox tag when removeTagOnAssign=false', async () => {
    const content = '- [ ] do thing #task/inbox\n';
    const { tm, app, settings } = await makeManager({ 'notes/tasks.md': content });
    settings.inbox.removeTagOnAssign = false;
    const task = makeTask({ line: 0, rawText: '- [ ] do thing #task/inbox' });
    await tm.assignTagFromInbox(task, '#task/next');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).toContain('#task/next');
    expect(updated).toContain('#task/inbox');
  });
});

describe('TagManager.replaceTagOnTask', () => {
  it('adds new tag and removes old tag in one operation', async () => {
    const content = '- [ ] do thing #task/inbox\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    const task = makeTask({ line: 0, rawText: '- [ ] do thing #task/inbox' });
    await tm.replaceTagOnTask(task, '#task/inbox', '#task/next');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).toContain('#task/next');
    expect(updated).not.toContain('#task/inbox');
  });

  it('is a no-op when oldTag equals newTag', async () => {
    const content = '- [ ] do thing #task/inbox\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    const task = makeTask({ line: 0, rawText: '- [ ] do thing #task/inbox' });
    await tm.replaceTagOnTask(task, '#task/inbox', '#task/inbox');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).toBe(content);
  });
});

describe('TagManager.renameTag', () => {
  it('renames tag across vault files and updates pinnedTags', async () => {
    const content = '- [ ] do thing #task/next\n';
    const { tm, app, settings } = await makeManager({ 'notes/tasks.md': content });
    settings.pinnedTags.push('#task/next');
    await tm.renameTag('#task/next', '#task/next-action');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    expect(updated).toContain('#task/next-action');
    expect(updated).not.toContain('#task/next ');
    expect(settings.pinnedTags).toContain('#task/next-action');
    expect(settings.pinnedTags).not.toContain('#task/next');
  });

  it('does not rename tags that are prefixes of other tags', async () => {
    const content = '- [ ] do thing #task/next-action\n';
    const { tm, app } = await makeManager({ 'notes/tasks.md': content });
    await tm.renameTag('#task/next', '#task/soon');
    const updated = await app.vault.read(
      app.vault.getAbstractFileByPath('notes/tasks.md') as never,
    );
    // #task/next-action should NOT be changed since #task/next is a prefix
    expect(updated).toContain('#task/next-action');
    expect(updated).not.toContain('#task/soon');
  });

  it('updates archivedTags when renaming an archived tag', async () => {
    const content = '- [ ] do thing\n';
    const { tm, settings } = await makeManager({ 'notes/tasks.md': content });
    settings.archivedTags.push('#task/old');
    await tm.renameTag('#task/old', '#task/new');
    expect(settings.archivedTags).toContain('#task/new');
    expect(settings.archivedTags).not.toContain('#task/old');
  });

  it('updates manual tagGroup entries when renaming', async () => {
    const content = '- [ ] do thing\n';
    const { tm, settings } = await makeManager({ 'notes/tasks.md': content });
    settings.tagGroups.push({ id: 'g1', name: 'Group 1', mode: 'manual', tags: ['#task/next'] });
    await tm.renameTag('#task/next', '#task/soon');
    const group = settings.tagGroups[0];
    expect(group?.tags ?? []).toContain('#task/soon');
    expect(group?.tags ?? []).not.toContain('#task/next');
  });
});
