import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migration';

describe('migrateSettings', () => {
  it('adds missing pinnedTags and archivedTags arrays', () => {
    const raw: Record<string, unknown> = {};
    migrateSettings(raw);
    expect(raw['pinnedTags']).toEqual([]);
    expect(raw['archivedTags']).toEqual([]);
  });

  it('converts old inboxMode=tag + inboxTag to inbox object', () => {
    const raw: Record<string, unknown> = { inboxMode: 'tag', inboxTag: '#inbox' };
    migrateSettings(raw);
    expect(raw['inbox']).toEqual({
      mode: 'tag',
      tag: '#inbox',
      removeTagOnAssign: true,
    });
    expect(raw['inboxMode']).toBeUndefined();
    expect(raw['inboxTag']).toBeUndefined();
  });

  it('converts old inboxMode=untagged to inbox with untagged mode', () => {
    const raw: Record<string, unknown> = { inboxMode: 'untagged', inboxTag: '#inbox' };
    migrateSettings(raw);
    expect((raw['inbox'] as Record<string, unknown>)['mode']).toBe('untagged');
    expect((raw['inbox'] as Record<string, unknown>)['showUntagged']).toBeUndefined();
    expect(raw['inboxMode']).toBeUndefined();
  });

  it('folds legacy showUntagged=true on tag mode into both mode and strips the flag', () => {
    const raw: Record<string, unknown> = {
      inbox: { mode: 'tag', tag: '#inbox', showUntagged: true, removeTagOnAssign: true },
    };
    migrateSettings(raw);
    const inbox = raw['inbox'] as Record<string, unknown>;
    expect(inbox['mode']).toBe('both');
    expect(inbox['showUntagged']).toBeUndefined();
  });

  it('strips legacy showUntagged without changing a non-tag mode', () => {
    const existing = {
      mode: 'both',
      tag: '#task/inbox',
      showUntagged: true,
      removeTagOnAssign: false,
    };
    const raw: Record<string, unknown> = { inbox: existing };
    migrateSettings(raw);
    expect(raw['inbox']).toBe(existing);
    expect((raw['inbox'] as Record<string, unknown>)['mode']).toBe('both');
    expect((raw['inbox'] as Record<string, unknown>)['showUntagged']).toBeUndefined();
  });

  it('preserves existing pinnedTags if already present', () => {
    const raw: Record<string, unknown> = { pinnedTags: ['#task/next'] };
    migrateSettings(raw);
    expect(raw['pinnedTags']).toEqual(['#task/next']);
  });
});

describe('projects migration', () => {
  it('adds projects + sectionCollapse when missing', () => {
    const raw: Record<string, unknown> = {};
    migrateSettings(raw);
    const projects = raw['projects'] as { statuses: unknown[]; defaultStatusId: string };
    expect(Array.isArray(projects.statuses)).toBe(true);
    expect(projects.statuses.length).toBeGreaterThan(0);
    const ids = (projects.statuses as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(projects.defaultStatusId);
    expect(raw['sectionCollapse']).toEqual({ pinned: false, projects: false, tags: false });
  });
  it('repoints a dangling defaultStatusId to the first status', () => {
    const raw: Record<string, unknown> = {};
    migrateSettings(raw);
    const projects = raw['projects'] as { statuses: { id: string }[]; defaultStatusId: string };
    projects.defaultStatusId = 'nonexistent';
    migrateSettings(raw);
    expect(projects.defaultStatusId).toBe(projects.statuses[0]!.id);
  });
});

describe('task statuses migration', () => {
  it('seeds taskStatuses when missing', () => {
    const raw: Record<string, unknown> = {}; // legacy settings without taskStatuses
    migrateSettings(raw);
    const seeded = raw['taskStatuses'] as unknown[];
    expect(Array.isArray(seeded)).toBe(true);
    expect(seeded.length).toBeGreaterThanOrEqual(6);
  });

  it('never overwrites an existing taskStatuses list', () => {
    const existing = [
      {
        id: 'x',
        symbol: 'q',
        name: 'Q',
        type: 'todo',
        color: '',
        icon: '',
        iconKind: 'glyph',
        core: false,
      },
    ];
    const raw: Record<string, unknown> = { taskStatuses: existing };
    migrateSettings(raw);
    expect(raw['taskStatuses']).toHaveLength(1);
    expect((raw['taskStatuses'] as Array<{ symbol: string }>)[0]!.symbol).toBe('q');
  });

  it('strips legacy color and iconKind fields from every status entry', () => {
    const raw: Record<string, unknown> = {
      taskStatuses: [
        {
          id: 'x',
          symbol: 'q',
          name: 'Q',
          type: 'todo',
          color: '#abc',
          icon: 'star',
          iconKind: 'lucide',
          core: false,
        },
      ],
    };
    migrateSettings(raw);
    const entry = (raw['taskStatuses'] as Array<Record<string, unknown>>)[0]!;
    expect(entry['color']).toBeUndefined();
    expect(entry['iconKind']).toBeUndefined();
    expect(entry['icon']).toBe('star');
  });

  it('clears the icon of a legacy glyph-kind status (glyphs are no longer supported)', () => {
    const raw: Record<string, unknown> = {
      taskStatuses: [
        {
          id: 'x',
          symbol: 'q',
          name: 'Q',
          type: 'todo',
          color: '',
          icon: '*',
          iconKind: 'glyph',
          core: false,
        },
      ],
    };
    migrateSettings(raw);
    const entry = (raw['taskStatuses'] as Array<Record<string, unknown>>)[0]!;
    expect(entry['icon']).toBe('');
    expect(entry['iconKind']).toBeUndefined();
  });
});
