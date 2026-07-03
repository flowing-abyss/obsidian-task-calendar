import { TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../src/projects/ProjectManager';
import { DailyNoteResolver } from '../src/resolvers/DailyNoteResolver';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { CalendarSettings } from '../src/settings/types';
import { createAppWithFiles, flushMicrotasks, useRealMoment } from './helpers';

useRealMoment();

function clone(): CalendarSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as CalendarSettings;
}

async function readFm(app: unknown, path: string): Promise<Record<string, unknown>> {
  const a = app as {
    vault: { getAbstractFileByPath(p: string): unknown; read(f: TFile): Promise<string> };
  };
  const file = a.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`${path} is not a TFile`);
  const content = await a.vault.read(file);
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  const fm: Record<string, unknown> = {};
  if (m) {
    for (const line of m[1]!.split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return fm;
}

describe('ProjectManager.setStatus', () => {
  it('writes the target property status and clears sibling property markers', async () => {
    const app = await createAppWithFiles({
      'P.md': '---\nstatus: active\nother: keep\n---\n\n- [ ] a task\n',
    });
    const settings = clone();
    const doneId = settings.projects.statuses[2]!.id; // Done → status=done
    const pm = new ProjectManager(app as never, settings, {} as never);
    await pm.setStatus('P.md', doneId);
    await flushMicrotasks();
    const fm = await readFm(app, 'P.md');
    expect(fm['status']).toBe('done');
    expect(fm['other']).toBe('keep');
  });

  it('adds a tag marker and strips sibling tag markers for tag-kind statuses', async () => {
    const app = await createAppWithFiles({ 'P.md': '---\ntags:\n  - todo\n  - keepme\n---\n' });
    const settings = clone();
    settings.projects.statuses = [
      { id: 'todo', label: 'Todo', onLeftPanel: true, match: { kind: 'tag', tag: 'todo' } },
      { id: 'wip', label: 'WIP', onLeftPanel: true, match: { kind: 'tag', tag: 'wip' } },
    ];
    const pm = new ProjectManager(app as never, settings, {} as never);
    await pm.setStatus('P.md', 'wip');
    await flushMicrotasks();
    const file = (
      app as never as { vault: { getAbstractFileByPath(p: string): TFile } }
    ).vault.getAbstractFileByPath('P.md');
    const content = await (
      app as never as { vault: { read(f: TFile): Promise<string> } }
    ).vault.read(file);
    expect(content).toContain('wip');
    expect(content).toContain('keepme');
    expect(content).not.toMatch(/- todo\b/);
  });
});

describe('ProjectManager.create', () => {
  it('builds a path under createFolder, applies default status, opens the note', async () => {
    const app = await createAppWithFiles({});
    const settings = clone();
    const resolver = new DailyNoteResolver(app as never, settings);
    const pm = new ProjectManager(app as never, settings, resolver);
    const file = await pm.create('My Project');
    await flushMicrotasks();
    expect(file).not.toBeNull();
    expect(file!.path).toBe('Projects/My Project.md');
    const fm = await readFm(app, 'Projects/My Project.md');
    expect(fm['status']).toBe('active');
  });

  it('dedupes the path when a note already exists', async () => {
    const app = await createAppWithFiles({ 'Projects/Dup.md': '# existing\n' });
    const settings = clone();
    const resolver = new DailyNoteResolver(app as never, settings);
    const pm = new ProjectManager(app as never, settings, resolver);
    const file = await pm.create('Dup');
    expect(file!.path).toBe('Projects/Dup 2.md');
  });

  it('returns null for an empty name', async () => {
    const app = await createAppWithFiles({});
    const pm = new ProjectManager(app as never, clone(), {} as never);
    expect(await pm.create('   ')).toBeNull();
  });
});
