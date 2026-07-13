import { App as ObsidianApp, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { TaskLocator } from '../src/mutation/TaskLocator';
import { TaskMutationService } from '../src/mutation/TaskMutationService';
import { canonicalStatusCatalog, createAppWithFiles } from './helpers';

async function readFile(app: ObsidianApp, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`${path} not a TFile`);
  return app.vault.cachedRead(f);
}

function svc(app: ObsidianApp): TaskMutationService {
  return new TaskMutationService(app, undefined, canonicalStatusCatalog);
}

describe('TaskMutationService.moveTaskToFile', () => {
  it('moves a task line out of the source and appends it to the target (append mode)', async () => {
    const app = await createAppWithFiles({
      'inbox.md': '- [ ] Buy milk 📅 2026-07-15\n- [ ] keep me',
      'Projects/Redesign.md': '# Redesign\nintro',
    });
    const locator: TaskLocator = {
      filePath: 'inbox.md',
      rawText: '- [ ] Buy milk 📅 2026-07-15',
      line: 0,
    };

    const result = await svc(app).moveTaskToFile(locator, 'Projects/Redesign.md', {
      mode: 'append',
      section: '## Tasks',
    });

    expect(result.type).toBe('ok');
    expect(await readFile(app, 'inbox.md')).toBe('- [ ] keep me');
    expect(await readFile(app, 'Projects/Redesign.md')).toBe(
      '# Redesign\nintro\n- [ ] Buy milk 📅 2026-07-15\n',
    );
  });

  it('inserts under the configured section when the target has one', async () => {
    const app = await createAppWithFiles({
      'inbox.md': '- [ ] task A',
      'Projects/P.md': '# P\n## Tasks\n- [ ] existing\n## Notes',
    });
    const locator: TaskLocator = { filePath: 'inbox.md', rawText: '- [ ] task A', line: 0 };

    await svc(app).moveTaskToFile(locator, 'Projects/P.md', {
      mode: 'section',
      section: '## Tasks',
    });

    expect(await readFile(app, 'Projects/P.md')).toBe(
      '# P\n## Tasks\n- [ ] task A\n- [ ] existing\n## Notes',
    );
    expect(await readFile(app, 'inbox.md')).toBe('');
  });

  it('moves the whole sub-item block, not just the task line', async () => {
    const app = await createAppWithFiles({
      'inbox.md': '- [ ] parent\n\t- [ ] child\n\t- note\n- [ ] sibling',
      'Projects/P.md': 'body',
    });
    const locator: TaskLocator = { filePath: 'inbox.md', rawText: '- [ ] parent', line: 0 };

    await svc(app).moveTaskToFile(locator, 'Projects/P.md', { mode: 'append', section: '' });

    expect(await readFile(app, 'inbox.md')).toBe('- [ ] sibling');
    expect(await readFile(app, 'Projects/P.md')).toBe(
      'body\n- [ ] parent\n\t- [ ] child\n\t- note\n',
    );
  });

  it('is a no-op when the task is already in the target file', async () => {
    const app = await createAppWithFiles({ 'Projects/P.md': '- [ ] here' });
    const locator: TaskLocator = { filePath: 'Projects/P.md', rawText: '- [ ] here', line: 0 };

    const result = await svc(app).moveTaskToFile(locator, 'Projects/P.md', {
      mode: 'append',
      section: '',
    });

    expect(result.type).toBe('ok');
    expect(await readFile(app, 'Projects/P.md')).toBe('- [ ] here');
  });

  it('returns file-not-found and does not touch the source when target is missing', async () => {
    const app = await createAppWithFiles({ 'inbox.md': '- [ ] task' });
    const locator: TaskLocator = { filePath: 'inbox.md', rawText: '- [ ] task', line: 0 };

    const result = await svc(app).moveTaskToFile(locator, 'Projects/Missing.md', {
      mode: 'append',
      section: '',
    });

    expect(result.type).toBe('file-not-found');
    expect(await readFile(app, 'inbox.md')).toBe('- [ ] task');
  });

  it('returns not-found and leaves both files unchanged when the task no longer exists', async () => {
    const app = await createAppWithFiles({
      'inbox.md': '- [ ] different now',
      'Projects/P.md': 'body',
    });
    const locator: TaskLocator = { filePath: 'inbox.md', rawText: '- [ ] gone', line: 0 };

    const result = await svc(app).moveTaskToFile(locator, 'Projects/P.md', {
      mode: 'append',
      section: '',
    });

    expect(result.type).toBe('not-found');
    expect(await readFile(app, 'inbox.md')).toBe('- [ ] different now');
    expect(await readFile(app, 'Projects/P.md')).toBe('body');
  });

  it('does not duplicate into the target when the source task is ambiguous', async () => {
    const app = await createAppWithFiles({
      'inbox.md': '- [ ] dup\n- [ ] dup',
      'Projects/P.md': 'body',
    });
    const locator: TaskLocator = { filePath: 'inbox.md', rawText: '- [ ] dup', line: 99 };

    const result = await svc(app).moveTaskToFile(locator, 'Projects/P.md', {
      mode: 'append',
      section: '',
    });

    expect(result.type).toBe('ambiguous');
    expect(await readFile(app, 'inbox.md')).toBe('- [ ] dup\n- [ ] dup');
    expect(await readFile(app, 'Projects/P.md')).toBe('body');
  });
});
