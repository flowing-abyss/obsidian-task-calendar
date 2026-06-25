// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { TFile, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { TaskStore } from '../src/store/TaskStore';
import { TagManager } from '../src/tags/TagManager';
import { createAppWithFiles, makeStubStore, task, useRealMoment } from './helpers';

useRealMoment();

async function readMd(app: App, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`${path} is not a TFile`);
  return app.vault.cachedRead(f);
}

function callPrivate<T>(panel: CenterPanel, method: string, ...args: unknown[]): T {
  const fn = (panel as unknown as Record<string, (...a: unknown[]) => T>)[method]!;
  return fn.call(panel, ...args);
}

async function makePanel(
  files: Record<string, string>,
  extraTasks: Task[] = [],
): Promise<{ panel: CenterPanel; app: App }> {
  const app = await createAppWithFiles(files);
  const state = new AppState();
  const save = vi.fn().mockResolvedValue(undefined);
  const tm = new TagManager(null as never, DEFAULT_SETTINGS, save);
  const store = makeStubStore(extraTasks) as unknown as TaskStore;
  const panel = new CenterPanel(state, store, app, DEFAULT_SETTINGS, tm);
  return { panel, app };
}

describe('CenterPanel.toggleDueToday', () => {
  it('sets due date when task has no due', async () => {
    const today = moment().format('YYYY-MM-DD');
    const { panel, app } = await makePanel({ 'n.md': '- [ ] Buy milk\n' });
    const t = task({ filePath: 'n.md', line: 0, rawText: '- [ ] Buy milk', due: undefined });
    await callPrivate(panel, 'toggleDueToday', t);
    const content = await readMd(app, 'n.md');
    expect(content).toContain(`📅 ${today}`);
  });

  it('clears due date when task already has today as due', async () => {
    const today = moment().format('YYYY-MM-DD');
    const raw = `- [ ] Buy milk 📅 ${today}`;
    const { panel, app } = await makePanel({ 'n.md': `${raw}\n` });
    const t = task({ filePath: 'n.md', line: 0, rawText: raw, due: today });
    await callPrivate(panel, 'toggleDueToday', t);
    const content = await readMd(app, 'n.md');
    expect(content).not.toMatch(/📅\s*\d{4}-\d{2}-\d{2}/u);
  });

  it('replaces existing non-today due date with today', async () => {
    const today = moment().format('YYYY-MM-DD');
    const raw = '- [ ] Buy milk 📅 2020-01-01';
    const { panel, app } = await makePanel({ 'n.md': `${raw}\n` });
    const t = task({ filePath: 'n.md', line: 0, rawText: raw, due: '2020-01-01' });
    await callPrivate(panel, 'toggleDueToday', t);
    const content = await readMd(app, 'n.md');
    expect(content).toContain(`📅 ${today}`);
    expect(content).not.toContain('2020-01-01');
  });
});

describe('CenterPanel.setPriority', () => {
  it('adds priority emoji when task has none', async () => {
    const { panel, app } = await makePanel({ 'n.md': '- [ ] Task\n' });
    const t = task({ filePath: 'n.md', line: 0, rawText: '- [ ] Task', priority: 'D' });
    await callPrivate(panel, 'setPriority', t, 'A');
    const content = await readMd(app, 'n.md');
    expect(content).toContain('🔺');
  });

  it('removes all priority emojis when D (normal) is selected', async () => {
    const raw = '- [ ] Task 🔺';
    const { panel, app } = await makePanel({ 'n.md': `${raw}\n` });
    const t = task({ filePath: 'n.md', line: 0, rawText: raw, priority: 'A' });
    await callPrivate(panel, 'setPriority', t, 'D');
    const content = await readMd(app, 'n.md');
    expect(content).not.toMatch(/[🔺⏫🔼🔽⏬]/u);
  });

  it('replaces existing priority with new one', async () => {
    const raw = '- [ ] Task ⏫';
    const { panel, app } = await makePanel({ 'n.md': `${raw}\n` });
    const t = task({ filePath: 'n.md', line: 0, rawText: raw, priority: 'B' });
    await callPrivate(panel, 'setPriority', t, 'C');
    const content = await readMd(app, 'n.md');
    expect(content).toContain('🔼');
    expect(content).not.toContain('⏫');
  });
});
