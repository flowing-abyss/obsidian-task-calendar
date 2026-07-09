/**
 * Insert a task line (or a multi-line task block) into a note's content,
 * honoring the plugin's task-insertion setting. Pure string transform so it can
 * be shared by every write path (new-task creation, cross-file move) and unit
 * tested without a vault.
 *
 * - `section` mode places the block directly under the first heading line that
 *   equals `section`; if that heading is absent the section is appended first.
 * - `append` mode (or a blank section name) appends the block at the end.
 *
 * `block` may contain newlines; it stays contiguous because it is spliced/joined
 * as a single unit.
 */
export function insertTaskBlockIntoContent(
  content: string,
  block: string,
  mode: 'append' | 'section',
  section: string,
): string {
  if (mode === 'section' && section.trim()) {
    const lines = content.split('\n');
    const idx = lines.findIndex((l) => l.trim() === section.trim());
    if (idx === -1) {
      return content.trimEnd() + '\n\n' + section + '\n' + block + '\n';
    }
    lines.splice(idx + 1, 0, block);
    return lines.join('\n');
  }
  return content.trimEnd() + '\n' + block + '\n';
}
