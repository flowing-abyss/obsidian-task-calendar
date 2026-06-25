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
      showUntagged: false,
      removeTagOnAssign: true,
    });
    expect(raw['inboxMode']).toBeUndefined();
    expect(raw['inboxTag']).toBeUndefined();
  });

  it('converts old inboxMode=untagged to inbox with showUntagged:true', () => {
    const raw: Record<string, unknown> = { inboxMode: 'untagged', inboxTag: '#inbox' };
    migrateSettings(raw);
    expect((raw['inbox'] as Record<string, unknown>)['mode']).toBe('untagged');
    expect((raw['inbox'] as Record<string, unknown>)['showUntagged']).toBe(true);
    expect(raw['inboxMode']).toBeUndefined();
  });

  it('does not overwrite existing inbox object', () => {
    const existing = {
      mode: 'both',
      tag: '#task/inbox',
      showUntagged: true,
      removeTagOnAssign: false,
    };
    const raw: Record<string, unknown> = { inbox: existing };
    migrateSettings(raw);
    expect(raw['inbox']).toBe(existing);
  });

  it('preserves existing pinnedTags if already present', () => {
    const raw: Record<string, unknown> = { pinnedTags: ['#task/next'] };
    migrateSettings(raw);
    expect(raw['pinnedTags']).toEqual(['#task/next']);
  });
});
