import { buildDefaultProjectsSettings, buildDefaultTaskStatuses } from './defaults';

function migrateInbox(raw: Record<string, unknown>): void {
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
}

function migrateProjects(raw: Record<string, unknown>): void {
  if (!('projects' in raw)) raw['projects'] = buildDefaultProjectsSettings();
  const projects = raw['projects'];
  if (projects && typeof projects === 'object') {
    const p = projects as { statuses?: { id: string }[]; defaultStatusId?: string };
    const ids = (p.statuses ?? []).map((s) => s.id);
    if (!p.defaultStatusId || !ids.includes(p.defaultStatusId)) {
      p.defaultStatusId = ids[0] ?? '';
    }
  }
}

/**
 * Per-status color/iconKind were folded into the priority-color + lucide-only
 * visual contract: color is no longer stored per status, and glyph icons are
 * no longer supported (Lucide only). Check iconKind BEFORE deleting it.
 */
function stripLegacyStatusFields(taskStatuses: unknown[]): void {
  for (const entry of taskStatuses) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e['iconKind'] === 'glyph') e['icon'] = '';
    delete e['color'];
    delete e['iconKind'];
  }
}

/**
 * Core statuses must stay fully locked and predictable — heal any drift
 * (e.g. an older build's icon/symbol) back to the canonical default so a
 * core status's appearance never depends on when the user first installed.
 * Matched by `type`, since each of the 4 core types is unique. Non-core
 * (user-added) statuses are left untouched.
 */
function healCoreStatuses(taskStatuses: unknown[]): void {
  const canonicalCore = buildDefaultTaskStatuses().filter((s) => s.core);
  for (const entry of taskStatuses) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e['core'] !== true) continue;
    const canonical = canonicalCore.find((c) => c.type === e['type']);
    if (!canonical) continue;
    e['symbol'] = canonical.symbol;
    e['type'] = canonical.type;
    e['icon'] = canonical.icon;
  }
}

function migrateTaskStatuses(raw: Record<string, unknown>): void {
  if (
    !('taskStatuses' in raw) ||
    !Array.isArray(raw['taskStatuses']) ||
    (raw['taskStatuses'] as unknown[]).length === 0
  ) {
    raw['taskStatuses'] = buildDefaultTaskStatuses();
  }
  const taskStatuses = raw['taskStatuses'];
  if (!Array.isArray(taskStatuses)) return;
  stripLegacyStatusFields(taskStatuses);
  healCoreStatuses(taskStatuses);
}

export function migrateSettings(raw: Record<string, unknown>): void {
  migrateInbox(raw);
  if (!('pinnedTags' in raw)) raw['pinnedTags'] = [];
  if (!('archivedTags' in raw)) raw['archivedTags'] = [];
  migrateProjects(raw);
  if (!('sectionCollapse' in raw)) {
    raw['sectionCollapse'] = { pinned: false, projects: false, tags: false };
  }
  migrateTaskStatuses(raw);
}
