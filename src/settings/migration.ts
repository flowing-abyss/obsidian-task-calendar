export function migrateSettings(raw: Record<string, unknown>): void {
  if (!('inbox' in raw)) {
    raw['inbox'] = {
      mode: raw['inboxMode'] ?? 'tag',
      tag: raw['inboxTag'] ?? '#task/inbox',
      showUntagged: raw['inboxMode'] === 'untagged',
      removeTagOnAssign: true,
    };
    delete raw['inboxMode'];
    delete raw['inboxTag'];
  }
  if (!('pinnedTags' in raw)) raw['pinnedTags'] = [];
  if (!('archivedTags' in raw)) raw['archivedTags'] = [];
}
