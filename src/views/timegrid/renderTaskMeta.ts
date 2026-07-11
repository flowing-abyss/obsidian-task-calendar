import { setIcon } from 'obsidian';
import type { Task } from '../../parser/types';
import type { TagGroup } from '../../settings/types';
import { colorForTag } from '../../tags/tagColor';

const TAG_RE = /#[\w/-]+/gu;

/** Extracts up to `max` hashtags from a task's raw line, same convention as CenterPanel. */
export function extractTags(task: Task, max = Infinity): string[] {
  const tags = task.rawText.match(TAG_RE) ?? [];
  return max === Infinity ? tags : tags.slice(0, max);
}

/**
 * Renders subtask/comment/link count badges into `container`, matching CenterPanel's
 * `.tc-task-count-badge` visual language (same class + lucide icons) so the calendar's
 * badges look identical to the main task list's. Purely presentational — these badges
 * carry no click handlers in CenterPanel either, so no drag/pointerdown guard is needed
 * here (unlike tag chips below, which CenterPanel makes interactive — see renderTagChips).
 */
export function renderCountBadges(container: HTMLElement, task: Task): void {
  const subtaskCount = task.subtasks?.length ?? 0;
  const commentCount = task.comments?.length ?? 0;
  const linkCount = task.linkCount ?? 0;

  if (subtaskCount > 0) {
    const doneCount = task.subtasks?.filter((s) => s.status === 'done').length ?? 0;
    const badge = container.createEl('span', { cls: 'tc-task-count-badge' });
    setIcon(badge, 'check-square');
    badge.createEl('span', { text: `${doneCount}/${subtaskCount}` });
  }
  if (commentCount > 0) {
    const badge = container.createEl('span', { cls: 'tc-task-count-badge' });
    setIcon(badge, 'message-square');
    badge.createEl('span', { text: String(commentCount) });
  }
  if (linkCount > 0) {
    const badge = container.createEl('span', { cls: 'tc-task-count-badge' });
    setIcon(badge, 'paperclip');
    badge.createEl('span', { text: String(linkCount) });
  }
}

/**
 * Renders up to `max` tag chips into `container`, matching CenterPanel's `.tc-task-tag`
 * visual language (color driven by the same `colorForTag` lookup). Deliberately
 * NON-interactive (no click-to-filter, no drag-to-replace) — CenterPanel's tag chips are
 * interactive, but calendar blocks already run delicate pointerdown-based drag/resize
 * logic (renderTimedBlocks.ts's onPointerDown, attachEdgeResize in renderAllDay.ts) and
 * adding a new interactive child would need the same exclusion-guard treatment already
 * applied to the checkbox/resize-handle/links there. Keeping these chips inert avoids
 * that whole bug class.
 */
export function renderTagChips(
  container: HTMLElement,
  task: Task,
  tagGroups: TagGroup[],
  max = 3,
): void {
  const tags = extractTags(task, max);
  for (const tag of tags) {
    const tagEl = container.createEl('span', { cls: 'tc-task-tag', text: tag });
    const color = colorForTag(tag, tagGroups);
    if (color) {
      tagEl.setCssProps({ '--tc-tag-color': color });
      tagEl.addClass('tc-task-tag--colored');
    }
  }
}

/** True if the task has anything for renderCountBadges/renderTagChips to show. */
export function hasMeta(task: Task): boolean {
  return (
    (task.subtasks?.length ?? 0) > 0 ||
    (task.comments?.length ?? 0) > 0 ||
    (task.linkCount ?? 0) > 0 ||
    extractTags(task, 1).length > 0
  );
}

/**
 * True if the task has anything for renderCountBadges alone to show (subtasks/comments/links)
 * — deliberately excludes tags, unlike `hasMeta` above. Used by Week/Day's timed-block renderers
 * (renderTimedBlocks.ts), which stopped rendering tag chips at all (Task 35: the block's own
 * tag-colored fill already conveys the tag, so a chip was redundant) — gating on `hasMeta` there
 * would keep reserving/showing an (now chip-less) badges container for a tag-only task that has
 * no counts to show.
 */
export function hasCountBadges(task: Task): boolean {
  return (
    (task.subtasks?.length ?? 0) > 0 ||
    (task.comments?.length ?? 0) > 0 ||
    (task.linkCount ?? 0) > 0
  );
}
