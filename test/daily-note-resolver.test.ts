import { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { DailyNoteResolver } from '../src/resolvers/DailyNoteResolver';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { useRealMoment } from './helpers';

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
