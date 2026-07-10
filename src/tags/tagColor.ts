import type { TagGroup } from '../settings/types';

const TAG_RE = /#[\w/-]+/u;

/**
 * The color for an already-extracted tag string (e.g. "#work" or "work"), matching it
 * against the plugin's configured tag groups. Shared by `RightPanel`'s per-chip lookup
 * (which already has each tag parsed out) and `tagColorFor` below (which extracts the
 * first tag from raw task text before delegating here).
 */
export function colorForTag(tag: string, tagGroups: TagGroup[]): string | undefined {
  const noHash = tag.replace(/^#/, '');
  for (const group of tagGroups) {
    if (group.mode === 'prefix' && group.prefix) {
      if (noHash === group.prefix || noHash.startsWith(`${group.prefix}/`)) {
        return group.color;
      }
    } else if (group.mode === 'manual' && group.tags) {
      if (group.tags.includes(tag) || group.tags.includes(noHash)) {
        return group.color;
      }
    }
  }
  return undefined;
}

/** The color for a task's first matching tag group, or undefined if no tag/no matching group. */
export function tagColorFor(rawText: string, tagGroups: TagGroup[]): string | undefined {
  const match = TAG_RE.exec(rawText);
  if (!match) return undefined;
  return colorForTag(match[0], tagGroups);
}
