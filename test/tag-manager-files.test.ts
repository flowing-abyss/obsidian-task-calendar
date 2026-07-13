// test/tag-manager-files.test.ts
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { TagManager } from '../src/tags/TagManager';
import { createAppWithFiles } from './helpers';

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
