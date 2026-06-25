export interface SubtaskRange {
  line: number;
  rangeTo: number;
}

export function applySubtaskReorder(
  content: string,
  moved: SubtaskRange,
  target: SubtaskRange,
  position: 'before' | 'after',
): string {
  if (moved.line === target.line) return content;

  const lines = content.split('\n');
  const blockSize = moved.rangeTo - moved.line + 1;
  const block = lines.splice(moved.line, blockSize);

  let insertAt: number;
  if (moved.line < target.line) {
    // Block removed from above: target indices shifted up by blockSize
    const adjLine = target.line - blockSize;
    const adjRangeTo = target.rangeTo - blockSize;
    insertAt = position === 'before' ? adjLine : adjRangeTo + 1;
  } else {
    // Block removed from below: target indices unchanged
    insertAt = position === 'before' ? target.line : target.rangeTo + 1;
  }

  lines.splice(insertAt, 0, ...block);
  return lines.join('\n');
}
