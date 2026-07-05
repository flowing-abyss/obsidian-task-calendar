import { buildDefaultProjectsSettings, buildDefaultTaskStatuses } from './defaults';

export function migrateSettings(raw: Record<string, unknown>): void {
  if (!('inbox' in raw)) {
    raw['inbox'] = {
      mode: raw['inboxMode'] ?? 'tag',
      tag: raw['inboxTag'] ?? '#task/inbox',
      removeTagOnAssign: true,
    };
    delete raw['inboxMode'];
    delete raw['inboxTag'];
  }
  // The old `showUntagged` toggle was folded into `mode`: tag + showUntagged === both.
  const inbox = raw['inbox'];
  if (inbox && typeof inbox === 'object') {
    const box = inbox as Record<string, unknown>;
    if ('showUntagged' in box) {
      if (box['showUntagged'] === true && box['mode'] === 'tag') box['mode'] = 'both';
      delete box['showUntagged'];
    }
  }
  if (!('pinnedTags' in raw)) raw['pinnedTags'] = [];
  if (!('archivedTags' in raw)) raw['archivedTags'] = [];
  if (!('projects' in raw)) raw['projects'] = buildDefaultProjectsSettings();
  if (!('sectionCollapse' in raw)) {
    raw['sectionCollapse'] = { pinned: false, projects: false, tags: false };
  }
  const projects = raw['projects'];
  if (projects && typeof projects === 'object') {
    const p = projects as { statuses?: { id: string }[]; defaultStatusId?: string };
    const ids = (p.statuses ?? []).map((s) => s.id);
    if (!p.defaultStatusId || !ids.includes(p.defaultStatusId)) {
      p.defaultStatusId = ids[0] ?? '';
    }
  }
  if (
    !('taskStatuses' in raw) ||
    !Array.isArray(raw['taskStatuses']) ||
    (raw['taskStatuses'] as unknown[]).length === 0
  ) {
    raw['taskStatuses'] = buildDefaultTaskStatuses();
  }
  // Per-status color/iconKind were folded into the priority-color + lucide-only
  // visual contract: color is no longer stored per status, and glyph icons are
  // no longer supported (Lucide only). Check iconKind BEFORE deleting it.
  const taskStatuses = raw['taskStatuses'];
  if (Array.isArray(taskStatuses)) {
    for (const entry of taskStatuses) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (e['iconKind'] === 'glyph') e['icon'] = '';
      delete e['color'];
      delete e['iconKind'];
    }
  }
}
