import { parseLinks } from '../../src/parser/links';
import type {
  TaskEditCommand,
  TaskRepository,
  TaskRepositoryResult,
} from '../../src/tasks/application/TaskRepository';
import type { PlanningTarget } from '../../src/tasks/domain/commands';
import type {
  CommentRef,
  SubtaskRef,
  SubtaskSnapshot,
  TaskMutationTarget,
  TaskNodeRef,
  TaskRef,
  TaskSnapshot,
} from '../../src/tasks/domain/types';
import { applyTaskCommand } from '../../src/tasks/infrastructure/markdown/applyTaskCommand';
import { TaskBlockEditor } from '../../src/tasks/infrastructure/markdown/TaskBlockEditor';
import { TaskLocator } from '../../src/tasks/infrastructure/markdown/TaskLocator';
import { TaskMarkdownCodec } from '../../src/tasks/infrastructure/markdown/TaskMarkdownCodec';

interface Options {
  readonly files: Record<string, string>;
  readonly codec: TaskMarkdownCodec;
  readonly snapshotsFromContent: (path: string, content: string) => readonly TaskSnapshot[];
  readonly editor?: TaskBlockEditor;
  readonly locator?: TaskLocator;
}

function rootRef(target: PlanningTarget): TaskRef {
  let node: TaskNodeRef = target;
  while (node.type === 'subtask') node = node.ref.parent;
  return node.ref;
}

function nodeTarget(command: TaskEditCommand): PlanningTarget | undefined {
  if (
    command.type === 'patch' ||
    command.type === 'set-status' ||
    command.type === 'append-title'
  ) {
    return command.target;
  }
  if (command.type === 'edit-link') {
    return command.target.type === 'comment' ? command.target.ref.parent : command.target.target;
  }
  return undefined;
}

function commandRootRef(command: TaskEditCommand): TaskRef {
  const target = nodeTarget(command);
  if (target) return rootRef(target);
  if ('ref' in command) return command.ref;
  throw new Error('Task edit command has no root reference');
}

function childChain(target: PlanningTarget): readonly SubtaskRef[] {
  const chain: SubtaskRef[] = [];
  let node: TaskNodeRef = target;
  while (node.type === 'subtask') {
    chain.unshift(node.ref);
    node = node.ref.parent;
  }
  return chain;
}

function legacyLine(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function confirmedLine(target: PlanningTarget, block: string): number | undefined {
  if (target.type === 'task') return 0;
  const rootLines = block.split(/\r?\n/u);
  let line = 0;
  for (const child of childChain(target)) {
    line += child.relativeLine;
    const expected = child.originalBlock.split(/\r?\n/u).map(legacyLine);
    if (rootLines.slice(line, line + expected.length).join('\n') !== expected.join('\n')) {
      return undefined;
    }
  }
  return line;
}

function targetOf(command: TaskEditCommand): TaskMutationTarget {
  if (
    command.type === 'patch' ||
    command.type === 'set-status' ||
    command.type === 'append-title'
  ) {
    return command.target;
  }
  if (command.type === 'edit-link') {
    return command.target.type === 'comment' ? command.target : command.target.target;
  }
  return { type: 'task', ref: command.ref };
}

function snapshotNode(
  root: TaskSnapshot,
  target: PlanningTarget,
): TaskSnapshot | SubtaskSnapshot | undefined {
  if (target.type === 'task') return root;
  let current: TaskSnapshot | SubtaskSnapshot = root;
  for (const child of childChain(target)) {
    const next: SubtaskSnapshot | undefined = current.subtasks.find(
      (candidate) =>
        candidate.ref.relativeLine === child.relativeLine &&
        candidate.ref.originalBlock === child.originalBlock,
    );
    if (!next) return undefined;
    current = next;
  }
  return current;
}

function descriptionLines(
  lines: readonly string[],
  rootRelativeLine: number,
  node: TaskSnapshot | SubtaskSnapshot,
  rootBlockLength: number,
): readonly number[] {
  const blockLength =
    'source' in node ? rootBlockLength : node.ref.originalBlock.split(/\r?\n/u).length;
  const childRanges = node.subtasks.map((child) => ({
    from: child.ref.relativeLine,
    to: child.ref.relativeLine + child.ref.originalBlock.split(/\r?\n/u).length - 1,
  }));
  const result: number[] = [];
  for (let relative = 1; relative < blockLength; relative++) {
    if (childRanges.some((range) => relative >= range.from && relative <= range.to)) continue;
    const candidate = rootRelativeLine + relative;
    if (/^[\s>]*- >(?:\s|$)/u.test(lines[candidate] ?? '')) result.push(candidate);
  }
  return result;
}

function commentLine(
  parentLine: number,
  comment: CommentRef,
  lines: readonly string[],
): number | undefined {
  const line = parentLine + comment.relativeLine;
  return lines[line] === legacyLine(comment.originalMarkdown) ? line : undefined;
}

function rebaseNode(node: TaskNodeRef, root: TaskRef): TaskNodeRef {
  if (node.type === 'task') return { type: 'task', ref: root };
  return {
    type: 'subtask',
    ref: { ...node.ref, parent: rebaseNode(node.ref.parent, root) },
  };
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly files: Map<string, string>;
  private readonly editor: TaskBlockEditor;
  private readonly locator: TaskLocator;

  constructor(private readonly options: Options) {
    this.files = new Map(Object.entries(options.files));
    this.editor = options.editor ?? new TaskBlockEditor();
    this.locator = options.locator ?? new TaskLocator();
  }

  content(path: string): string | undefined {
    return this.files.get(path);
  }

  async edit(command: TaskEditCommand): Promise<TaskRepositoryResult> {
    const target = nodeTarget(command);
    const ref = commandRootRef(command);
    const content = this.files.get(ref.filePath);
    if (content === undefined) return { type: 'not-found', target: targetOf(command) };
    const located = this.locator.locate(this.editor.rootBlocks(content), ref);
    if (located.type === 'not-found') return { type: 'not-found', target: targetOf(command) };
    if (located.type === 'conflict') {
      const current = this.snapshot(ref.filePath, content, located.block.line);
      return current
        ? { type: 'conflict', current }
        : { type: 'not-found', target: targetOf(command) };
    }
    if (located.type === 'ambiguous') {
      const original = targetOf(command);
      return {
        type: 'ambiguous',
        candidates: located.blocks.flatMap((block) => {
          const root = this.snapshot(ref.filePath, content, block.line);
          if (!root) return [];
          const target =
            original.type === 'comment'
              ? {
                  type: 'comment' as const,
                  ref: { ...original.ref, parent: rebaseNode(original.ref.parent, root.ref) },
                }
              : rebaseNode(original, root.ref);
          return [{ root, target }];
        }),
      };
    }

    const relativeLine = target ? confirmedLine(target, located.block.source) : 0;
    if (relativeLine === undefined) {
      const current = this.snapshot(ref.filePath, content, located.block.line);
      return current
        ? { type: 'conflict', current }
        : { type: 'not-found', target: targetOf(command) };
    }
    if (command.type === 'edit-link' && command.target.type !== 'title') {
      const current = this.snapshot(ref.filePath, content, located.block.line);
      const targetSnapshot = target ? current && snapshotNode(current, target) : undefined;
      if (!current || !targetSnapshot) {
        return current
          ? { type: 'conflict', current }
          : { type: 'not-found', target: targetOf(command) };
      }
      const lines = content.split(/\r?\n/u);
      let targetLine: number | undefined;
      let occurrence = command.occurrence;
      if (command.target.type === 'comment') {
        targetLine = commentLine(located.block.line + relativeLine, command.target.ref, lines);
      } else {
        for (const candidate of descriptionLines(
          lines.slice(located.block.line),
          relativeLine,
          targetSnapshot,
          located.block.toLine - located.block.line + 1,
        )) {
          const count = parseLinks(lines[located.block.line + candidate] ?? '').length;
          if (occurrence < count) {
            targetLine = located.block.line + candidate;
            break;
          }
          occurrence -= count;
        }
      }
      if (targetLine === undefined) {
        if (command.target.type === 'comment') return { type: 'conflict', current };
        return { type: 'invalid', issues: [{ code: 'invalid-target', field: 'link' }] };
      }
      const sourceLine = lines[targetLine] ?? '';
      const editResult = this.options.codec.editTextLink(
        sourceLine,
        occurrence,
        command.replacement,
      );
      if (editResult.type === 'invalid') return editResult;
      if (editResult.type === 'unchanged') {
        return { type: 'committed', outcome: { type: 'task', task: current }, changed: false };
      }
      const rootRelative = targetLine - located.block.line;
      const next = this.editor.replaceLine(
        content,
        located.block,
        rootRelative,
        editResult.content,
      ).content;
      this.files.set(ref.filePath, next);
      const root = this.snapshot(ref.filePath, next, located.block.line);
      return root
        ? { type: 'committed', outcome: { type: 'task', task: root }, changed: true }
        : { type: 'invalid', issues: [{ code: 'invalid-task-syntax' }] };
    }
    const lines = content.split(/\r?\n/u);
    const sourceLine = lines[located.block.line + relativeLine];
    if (sourceLine === undefined) return { type: 'not-found', target: targetOf(command) };
    const result = applyTaskCommand(this.options.codec, sourceLine, command);
    if (result.type === 'invalid') return result;
    const nextLine = result.content;
    const changed = result.type === 'changed';
    const nextContent = changed
      ? this.editor.replaceLine(content, located.block, relativeLine, nextLine).content
      : content;
    if (changed) this.files.set(ref.filePath, nextContent);
    const root = this.snapshot(ref.filePath, nextContent, located.block.line);
    return root
      ? { type: 'committed', outcome: { type: 'task', task: root }, changed }
      : { type: 'not-found', target: targetOf(command) };
  }

  private snapshot(path: string, content: string, line: number): TaskSnapshot | undefined {
    return this.options
      .snapshotsFromContent(path, content)
      .find((candidate) => candidate.source.line === line);
  }
}
