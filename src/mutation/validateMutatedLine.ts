import type { ParseContext } from '../parser/types';
import { TaskMarkdownCodec } from '../tasks/infrastructure/markdown/TaskMarkdownCodec';

/**
 * Temporary compatibility safety net for legacy line-mutating callers. New task writes use the
 * codec's typed edit result instead of validating an already-reconstructed candidate line.
 */
export function validateMutatedTaskLine(line: string, ctx: ParseContext): boolean {
  // TASK-ARCH-BRIDGE: remove in Task 12
  const codec = new TaskMarkdownCodec(ctx.statusCatalog);
  return codec.validateLine(line).length === 0;
}
