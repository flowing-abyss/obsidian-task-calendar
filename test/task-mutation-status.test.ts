/**
 * Tests for TaskMutationService.setStatusChar and the registry-driven
 * reimplementation of toggleCompletion (Task 4 of the custom-statuses feature).
 */
// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { App as ObsidianApp, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskLocator } from '../src/mutation/TaskLocator';
import { TaskMutationService } from '../src/mutation/TaskMutationService';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { createAppWithFiles } from './helpers';

beforeEach(() => {
  (window as unknown as { moment: unknown }).moment = moment;
});
afterEach(() => {
  (window as unknown as { moment?: unknown }).moment = undefined;
});

async function readFile(app: ObsidianApp, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`${path} not a TFile`);
  return app.vault.cachedRead(f);
}

const registry = new StatusRegistry(buildDefaultTaskStatuses());

function svc(app: ObsidianApp): TaskMutationService {
  return new TaskMutationService(app, () => registry);
}

describe('setStatusChar', () => {
  it('rewrites the marker char', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] call bank' });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] call bank', line: 0 };
    await svc(app).setStatusChar(locator, '!', '2026-07-04');
    expect(await readFile(app, 'f.md')).toBe('- [!] call bank');
  });

  it('appends ✅ date when moving into done and strips it when leaving', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] call bank' });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] call bank', line: 0 };
    await svc(app).setStatusChar(locator, 'x', '2026-07-04');
    let content = await readFile(app, 'f.md');
    expect(content).toContain('✅ 2026-07-04');

    const locator2: TaskLocator = { filePath: 'f.md', rawText: content, line: 0 };
    await svc(app).setStatusChar(locator2, ' ', '2026-07-04');
    content = await readFile(app, 'f.md');
    expect(content).not.toContain('✅');
  });

  it('appends ❌ date when moving into cancelled and strips when leaving', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] call bank' });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] call bank', line: 0 };
    await svc(app).setStatusChar(locator, '-', '2026-07-04');
    let content = await readFile(app, 'f.md');
    expect(content).toContain('❌ 2026-07-04');

    const locator2: TaskLocator = { filePath: 'f.md', rawText: content, line: 0 };
    await svc(app).setStatusChar(locator2, ' ', '2026-07-04');
    content = await readFile(app, 'f.md');
    expect(content).not.toContain('❌');
  });

  it('does not duplicate ✅ when already done', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] call bank' });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] call bank', line: 0 };
    await svc(app).setStatusChar(locator, 'x', '2026-07-04');
    const content1 = await readFile(app, 'f.md');
    const locator2: TaskLocator = { filePath: 'f.md', rawText: content1, line: 0 };
    await svc(app).setStatusChar(locator2, 'x', '2026-07-04');
    const content2 = await readFile(app, 'f.md');
    expect((content2.match(/✅/g) ?? []).length).toBe(1);
  });

  it('preserves priority/tags/dates on the line', async () => {
    const raw = '- [ ] task 🔺 📅 2026-07-10 #x';
    const app = await createAppWithFiles({ 'f.md': raw });
    const locator: TaskLocator = { filePath: 'f.md', rawText: raw, line: 0 };
    await svc(app).setStatusChar(locator, '!', '2026-07-04');
    const l = await readFile(app, 'f.md');
    expect(l).toContain('🔺');
    expect(l).toContain('📅 2026-07-10');
    expect(l).toContain('#x');
    expect(l).toContain('- [!]');
  });

  it('is a no-op (does not rewrite the ✅ stamp) when re-selecting the current status', async () => {
    const raw = '- [x] task ✅ 2026-06-01';
    const app = await createAppWithFiles({ 'f.md': raw });
    const locator: TaskLocator = { filePath: 'f.md', rawText: raw, line: 0 };
    await svc(app).setStatusChar(locator, 'x', '2026-07-04');
    const content = await readFile(app, 'f.md');
    expect(content).toBe(raw);
    expect(content).toContain('✅ 2026-06-01');
    expect(content).not.toContain('2026-07-04');
  });

  it('still updates the stamp on a genuine status transition', async () => {
    const raw = '- [x] task ✅ 2026-06-01';
    const app = await createAppWithFiles({ 'f.md': raw });
    const locator: TaskLocator = { filePath: 'f.md', rawText: raw, line: 0 };
    await svc(app).setStatusChar(locator, '-', '2026-07-04');
    const content = await readFile(app, 'f.md');
    expect(content).toContain('- [-]');
    expect(content).toContain('❌ 2026-07-04');
    expect(content).not.toContain('✅');
  });

  it('preserves trailing \\r on CRLF files', async () => {
    const crlf = '- [ ] Buy milk\r\n- [ ] other\r\n';
    const app = await createAppWithFiles({ 'f.md': crlf });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] Buy milk\r', line: 0 };
    await svc(app).setStatusChar(locator, 'x', '2026-07-04');
    const after = await readFile(app, 'f.md');
    const lines = after.split('\n');
    expect(lines[0]).toMatch(/\r$/);
    expect(lines[0]).toContain('✅ 2026-07-04');
  });
});

describe('toggleCompletion (registry-driven)', () => {
  it('toggles open → done → todo using registry default symbols', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] call bank' });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] call bank', line: 0 };
    await svc(app).toggleCompletion(locator, '2026-07-04');
    let content = await readFile(app, 'f.md');
    expect(content).toContain('- [x]');
    expect(content).toContain('✅ 2026-07-04');

    const locator2: TaskLocator = { filePath: 'f.md', rawText: content, line: 0 };
    await svc(app).toggleCompletion(locator2, '2026-07-04');
    content = await readFile(app, 'f.md');
    expect(content).toContain('- [ ]');
    expect(content).not.toContain('✅');
  });

  it('falls back to plain x/space toggling when no registry getter is supplied', async () => {
    const app = await createAppWithFiles({ 'f.md': '- [ ] task' });
    const locator: TaskLocator = { filePath: 'f.md', rawText: '- [ ] task', line: 0 };
    const plain = new TaskMutationService(app);
    await plain.toggleCompletion(locator, '2026-07-04');
    const content = await readFile(app, 'f.md');
    expect(content).toBe('- [x] task ✅ 2026-07-04');
  });
});
