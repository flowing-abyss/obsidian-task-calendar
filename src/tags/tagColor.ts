import type { TagGroup } from '../settings/types';

/**
 * The color for an already-extracted tag string (e.g. "#work" or "work"), matching it
 * against the plugin's configured tag groups.
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

/** The color for a task's first canonical tag, or undefined if no tag/no matching group. */
export function tagColorFor(
  tags: readonly string[] | undefined,
  tagGroups: TagGroup[],
): string | undefined {
  const first = tags?.[0];
  return first ? colorForTag(first, tagGroups) : undefined;
}
