import moment from 'moment';
import { App, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { DailyNoteResolver } from '../src/resolvers/DailyNoteResolver';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { createAppWithFiles, useRealMoment } from './helpers';

const TODAY = moment().format('YYYY-MM-DD');

useRealMoment();

function appWithPlugins(
  communityPlugins: Record<string, unknown> = {},
  internalPlugins: Record<string, unknown> = {},
): App {
  return {
    plugins: { getPlugin: (id: string) => communityPlugins[id] ?? null },
    internalPlugins: { getPluginById: (id: string) => internalPlugins[id] ?? null },
  } as unknown as App;
}

// ── getActiveAdapter ──────────────────────────────────────────────────────────

describe('DailyNoteResolver.getActiveAdapter', () => {
  it('auto selects periodic-notes when available', () => {
    const app = appWithPlugins({
      'periodic-notes': { settings: { daily: { enabled: true } } },
    });
    const resolver = new DailyNoteResolver(app, { ...DEFAULT_SETTINGS, dailyNoteProvider: 'auto' });
    expect(resolver.getActiveAdapter().id).toBe('periodic-notes');
  });

  it('auto falls back to core when periodic-notes not available', () => {
    const app = appWithPlugins({}, { 'daily-notes': { enabled: true, instance: { options: {} } } });
    const resolver = new DailyNoteResolver(app, { ...DEFAULT_SETTINGS, dailyNoteProvider: 'auto' });
    expect(resolver.getActiveAdapter().id).toBe('core');
  });

  it('auto falls back to ManualAdapter when no plugin available', () => {
    const app = appWithPlugins({}, {});
    const resolver = new DailyNoteResolver(app, { ...DEFAULT_SETTINGS, dailyNoteProvider: 'auto' });
    expect(resolver.getActiveAdapter().id).toBe('manual');
  });

  it('explicit provider selects that adapter', () => {
    const app = appWithPlugins(
      {
        'periodic-notes': { settings: { daily: { enabled: true } } },
      },
      {
        'daily-notes': { enabled: true, instance: { options: {} } },
      },
    );
    const resolver = new DailyNoteResolver(app, { ...DEFAULT_SETTINGS, dailyNoteProvider: 'core' });
    expect(resolver.getActiveAdapter().id).toBe('core');
  });

  it('explicit provider falls back to manual when that plugin not available', () => {
    const app = appWithPlugins({}, {});
    const resolver = new DailyNoteResolver(app, {
      ...DEFAULT_SETTINGS,
      dailyNoteProvider: 'periodic-notes',
    });
    expect(resolver.getActiveAdapter().id).toBe('manual');
  });
});

// ── getAvailableProviders ─────────────────────────────────────────────────────

describe('DailyNoteResolver.getAvailableProviders', () => {
  it('always includes auto and manual', () => {
    const app = appWithPlugins({}, {});
    const resolver = new DailyNoteResolver(app, DEFAULT_SETTINGS);
    const ids = resolver.getAvailableProviders().map((p) => p.id);
    expect(ids).toContain('auto');
    expect(ids).toContain('manual');
  });

  it('includes periodic-notes when available', () => {
    const app = appWithPlugins({
      'periodic-notes': { settings: { daily: { enabled: true } } },
    });
    const resolver = new DailyNoteResolver(app, DEFAULT_SETTINGS);
    const ids = resolver.getAvailableProviders().map((p) => p.id);
    expect(ids).toContain('periodic-notes');
  });

  it('auto label shows detected plugin name', () => {
    const app = appWithPlugins({
      'periodic-notes': { settings: { daily: { enabled: true } } },
    });
    const resolver = new DailyNoteResolver(app, DEFAULT_SETTINGS);
    const autoEntry = resolver.getAvailableProviders().find((p) => p.id === 'auto');
    expect(autoEntry?.label).toContain('Periodic Notes');
  });
});

// ── buildTaskLine ─────────────────────────────────────────────────────────────

describe('DailyNoteResolver.buildTaskLine', () => {
  it('includes prefix when set', () => {
    const resolver = new DailyNoteResolver({} as App, { ...DEFAULT_SETTINGS, taskPrefix: '#task' });
    expect(resolver.buildTaskLine('buy milk', '2026-06-25')).toBe(
      '- [ ] #task buy milk 📅 2026-06-25',
    );
  });

  it('omits prefix separator when taskPrefix is empty', () => {
    const resolver = new DailyNoteResolver({} as App, { ...DEFAULT_SETTINGS, taskPrefix: '' });
    expect(resolver.buildTaskLine('buy milk', '2026-06-25')).toBe('- [ ] buy milk 📅 2026-06-25');
  });

  it('trims whitespace from prefix', () => {
    const resolver = new DailyNoteResolver({} as App, {
      ...DEFAULT_SETTINGS,
      taskPrefix: '  #task  ',
    });
    expect(resolver.buildTaskLine('buy milk', '2026-06-25')).toBe(
      '- [ ] #task buy milk 📅 2026-06-25',
    );
  });
});

// ── insertTask (append mode) ──────────────────────────────────────────────────

describe('DailyNoteResolver.addTask — append mode', () => {
  it('appends task line to existing note', async () => {
    const app = await createAppWithFiles({ [`periodic/daily/${TODAY}.md`]: '# Today\n' });
    const settings = {
      ...DEFAULT_SETTINGS,
      taskPrefix: '',
      dailyNoteProvider: 'manual' as const,
      taskInsertionMode: 'append' as const,
      desktop: {
        ...DEFAULT_SETTINGS.desktop,
      },
      manualDailyNotePath: 'periodic/daily/YYYY-MM-DD',
    };
    const resolver = new DailyNoteResolver(app, settings);
    await resolver.addTask('buy milk', TODAY);
    const file = app.vault.getAbstractFileByPath(`periodic/daily/${TODAY}.md`);
    const content = await app.vault.cachedRead(file as TFile);
    expect(content).toContain(`- [ ] buy milk 📅 ${TODAY}`);
  });

  it('creates note when it does not exist', async () => {
    const app = await createAppWithFiles({});
    const settings = {
      ...DEFAULT_SETTINGS,
      taskPrefix: '',
      dailyNoteProvider: 'manual' as const,
      taskInsertionMode: 'append' as const,
      desktop: {
        ...DEFAULT_SETTINGS.desktop,
      },
      manualDailyNotePath: 'periodic/daily/YYYY-MM-DD',
    };
    const resolver = new DailyNoteResolver(app, settings);
    // mock moment to return fixed date so path is predictable
    const today = (
      window as unknown as { moment: (s?: string) => { format: (f: string) => string } }
    )
      .moment()
      .format('YYYY-MM-DD');
    await resolver.addTask('created task', today);
    const file = app.vault.getAbstractFileByPath(`periodic/daily/${today}.md`);
    expect(file).toBeInstanceOf(TFile);
  });
});

// ── insertTask (section mode) ─────────────────────────────────────────────────

describe('DailyNoteResolver.addTask — section mode', () => {
  it('inserts task under existing section heading', async () => {
    const app = await createAppWithFiles({
      [`periodic/daily/${TODAY}.md`]: '# Today\n\n## Tasks\n\n## Notes\n',
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      taskPrefix: '',
      dailyNoteProvider: 'manual' as const,
      taskInsertionMode: 'section' as const,
      taskInsertionSection: '## Tasks',
      desktop: {
        ...DEFAULT_SETTINGS.desktop,
      },
      manualDailyNotePath: 'periodic/daily/YYYY-MM-DD',
    };
    const resolver = new DailyNoteResolver(app, settings);
    await resolver.addTask('buy milk', TODAY);
    const file = app.vault.getAbstractFileByPath(`periodic/daily/${TODAY}.md`);
    const content = await app.vault.cachedRead(file as TFile);
    const taskIdx = content.indexOf('- [ ] buy milk');
    const tasksIdx = content.indexOf('## Tasks');
    const notesIdx = content.indexOf('## Notes');
    expect(taskIdx).toBeGreaterThan(tasksIdx);
    expect(taskIdx).toBeLessThan(notesIdx);
  });

  it('appends section heading when not found, then inserts task', async () => {
    const app = await createAppWithFiles({
      [`periodic/daily/${TODAY}.md`]: '# Today\n',
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      taskPrefix: '',
      dailyNoteProvider: 'manual' as const,
      taskInsertionMode: 'section' as const,
      taskInsertionSection: '## Tasks',
      desktop: {
        ...DEFAULT_SETTINGS.desktop,
      },
      manualDailyNotePath: 'periodic/daily/YYYY-MM-DD',
    };
    const resolver = new DailyNoteResolver(app, settings);
    await resolver.addTask('buy milk', TODAY);
    const file = app.vault.getAbstractFileByPath(`periodic/daily/${TODAY}.md`);
    const content = await app.vault.cachedRead(file as TFile);
    expect(content).toContain('## Tasks');
    expect(content.indexOf('- [ ] buy milk')).toBeGreaterThan(content.indexOf('## Tasks'));
  });

  it('falls back to append when taskInsertionSection is empty string', async () => {
    const app = await createAppWithFiles({
      [`periodic/daily/${TODAY}.md`]: '# Today\n\n\n',
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      taskPrefix: '',
      dailyNoteProvider: 'manual' as const,
      taskInsertionMode: 'section' as const,
      taskInsertionSection: '',
      desktop: {
        ...DEFAULT_SETTINGS.desktop,
      },
      manualDailyNotePath: 'periodic/daily/YYYY-MM-DD',
    };
    const resolver = new DailyNoteResolver(app, settings);
    await resolver.addTask('buy milk', TODAY);
    const file = app.vault.getAbstractFileByPath(`periodic/daily/${TODAY}.md`);
    const content = await app.vault.cachedRead(file as TFile);
    // Task should appear at end, not after first empty line
    expect(content.trimEnd()).toMatch(new RegExp(`- \\[ \\] buy milk 📅 ${TODAY}$`));
  });
});
