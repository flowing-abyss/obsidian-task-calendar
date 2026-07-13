import { TFile, type App } from 'obsidian';
import { parseLinks } from '../../../parser/links';
import type {
  TaskEditCommand,
  TaskRepository,
  TaskRepositoryResult,
} from '../../application/TaskRepository';
import type { PlanningTarget, TaskResolutionCandidate } from '../../domain/commands';
import type {
  CommentRef,
  SubtaskRef,
  SubtaskSnapshot,
  TaskMutationTarget,
  TaskNodeRef,
  TaskRef,
  TaskSnapshot,
} from '../../domain/types';
import { applyTaskCommand } from '../markdown/applyTaskCommand';
import type { TaskRootBlock } from '../markdown/TaskBlockEditor';
import { TaskBlockEditor } from '../markdown/TaskBlockEditor';
import { TaskLocator } from '../markdown/TaskLocator';
import { TaskMarkdownCodec } from '../markdown/TaskMarkdownCodec';

interface RepositoryOptions {
  readonly codec: TaskMarkdownCodec;
  readonly editor: TaskBlockEditor;
  readonly locator: TaskLocator;
  readonly snapshotsFromContent: (filePath: string, content: string) => readonly TaskSnapshot[];
}

function rootRefOf(target: PlanningTarget): TaskRef {
  let node: TaskNodeRef = target;
  while (node.type === 'subtask') node = node.ref.parent;
  return node.ref;
}

function nodeTargetOf(command: TaskEditCommand): PlanningTarget | undefined {
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

function rootRefForCommand(command: TaskEditCommand): TaskRef {
  const target = nodeTargetOf(command);
  if (target) return rootRefOf(target);
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

function confirmedTargetRelativeLine(
  target: PlanningTarget,
  rootBlock: TaskRootBlock,
): number | undefined {
  if (target.type === 'task') return 0;
  const rootLines = rootBlock.source.split(/\r?\n/u);
  let line = 0;
  for (const child of childChain(target)) {
    line += child.relativeLine;
    const expected = child.originalBlock.split(/\r?\n/u).map(legacyLine);
    const current = rootLines.slice(line, line + expected.length);
    if (
      current.length !== expected.length ||
      current.some((value, index) => value !== expected[index])
    ) {
      return undefined;
    }
  }
  return line;
}

function rebaseNode(node: TaskNodeRef, root: TaskRef): TaskNodeRef {
  if (node.type === 'task') return { type: 'task', ref: root };
  return {
    type: 'subtask',
    ref: { ...node.ref, parent: rebaseNode(node.ref.parent, root) },
  };
}

function rebaseSubtaskWithParent(
  task: SubtaskSnapshot,
  parent: TaskNodeRef,
  root: TaskRef,
): SubtaskSnapshot {
  const node: TaskNodeRef = { type: 'subtask', ref: { ...task.ref, parent } };
  return {
    ...task,
    ref: node.ref,
    planning: { ...task.planning },
    tags: [...task.tags],
    subtasks: task.subtasks.map((child) => rebaseSubtaskWithParent(child, node, root)),
    comments: task.comments.map((comment) => ({
      ...comment,
      ref: { ...comment.ref, parent: node },
    })),
  };
}

function rebaseSnapshot(task: TaskSnapshot, root: TaskRef): TaskSnapshot {
  const node: TaskNodeRef = { type: 'task', ref: root };
  return {
    ...task,
    ref: root,
    planning: { ...task.planning },
    tags: [...task.tags],
    subtasks: task.subtasks.map((child) => rebaseSubtaskWithParent(child, node, root)),
    comments: task.comments.map((comment) => ({
      ...comment,
      ref: { ...comment.ref, parent: node },
    })),
    source: { ...task.source, filePath: root.filePath, line: root.line },
    presentation: { ...task.presentation },
  };
}

function mutationTarget(command: TaskEditCommand): TaskMutationTarget {
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

function nodeSnapshot(
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
  rootBlock: TaskRootBlock,
): readonly number[] {
  const blockLength =
    'source' in node
      ? rootBlock.toLine - rootBlock.line + 1
      : node.ref.originalBlock.split(/\r?\n/u).length;
  const childRanges = node.subtasks.map((child) => ({
    from: child.ref.relativeLine,
    to: child.ref.relativeLine + child.ref.originalBlock.split(/\r?\n/u).length - 1,
  }));
  const result: number[] = [];
  for (let relative = 1; relative < blockLength; relative++) {
    if (childRanges.some((range) => relative >= range.from && relative <= range.to)) continue;
    const rootRelative = rootRelativeLine + relative;
    if (/^[\s>]*- >(?:\s|$)/u.test(lines[rootBlock.line + rootRelative] ?? '')) {
      result.push(rootRelative);
    }
  }
  return result;
}

function commentRelativeLine(
  parentRelativeLine: number,
  comment: CommentRef,
  lines: readonly string[],
  rootLine: number,
): number | undefined {
  const relativeLine = parentRelativeLine + comment.relativeLine;
  return lines[rootLine + relativeLine] === legacyLine(comment.originalMarkdown)
    ? relativeLine
    : undefined;
}

export class ObsidianTaskRepository implements TaskRepository {
  constructor(
    private readonly app: App,
    private readonly options: RepositoryOptions,
  ) {}

  async edit(command: TaskEditCommand): Promise<TaskRepositoryResult> {
    const rootRef = rootRefForCommand(command);
    const file = this.app.vault.getAbstractFileByPath(rootRef.filePath);
    if (!(file instanceof TFile)) {
      return { type: 'not-found', target: mutationTarget(command) };
    }

    let result: TaskRepositoryResult | undefined;
    try {
      await this.app.vault.process(file, (content) => {
        const blocks = this.options.editor.rootBlocks(content);
        const located = this.options.locator.locate(blocks, rootRef);
        if (located.type !== 'exact') {
          result = this.resolutionResult(located, command, rootRef.filePath, content);
          return content;
        }

        const nodeTarget = nodeTargetOf(command);
        const relativeLine = nodeTarget
          ? confirmedTargetRelativeLine(nodeTarget, located.block)
          : 0;
        if (relativeLine === undefined) {
          const current = this.snapshotFor(rootRef.filePath, content, located.block);
          result = current
            ? { type: 'conflict', current }
            : { type: 'not-found', target: mutationTarget(command) };
          return content;
        }

        if (command.type === 'edit-link' && command.target.type !== 'title') {
          const edit = this.editTextTarget(
            command,
            rootRef,
            content,
            located.block,
            relativeLine,
            nodeTarget,
          );
          result = edit.result;
          return edit.content;
        }
        const lines = content.split(/\r?\n/u);
        const sourceLine = lines[located.block.line + relativeLine];
        if (
          sourceLine === undefined ||
          !this.options.codec.parseLine(sourceLine, { filePath: '', line: 0 })
        ) {
          result = { type: 'not-found', target: mutationTarget(command) };
          return content;
        }

        const editResult = applyTaskCommand(this.options.codec, sourceLine, command);
        if (editResult.type === 'invalid') {
          result = editResult;
          return content;
        }
        if (editResult.type === 'unchanged') {
          const task = this.snapshotFor(rootRef.filePath, content, located.block);
          result = task
            ? { type: 'committed', outcome: { type: 'task', task }, changed: false }
            : { type: 'not-found', target: mutationTarget(command) };
          return content;
        }

        const replaced = this.options.editor.replaceLine(
          content,
          located.block,
          relativeLine,
          editResult.content,
        );
        const task = this.snapshotFor(rootRef.filePath, replaced.content, replaced.block);
        if (!task) {
          result = { type: 'invalid', issues: [{ code: 'invalid-task-syntax' }] };
          return content;
        }
        result = { type: 'committed', outcome: { type: 'task', task }, changed: true };
        return replaced.content;
      });
    } catch {
      return {
        type: 'io-error',
        cause: 'process-error',
        path: rootRef.filePath,
        contentState: 'unknown',
      };
    }
    return (
      result ?? {
        type: 'io-error',
        cause: 'process-error',
        path: rootRef.filePath,
        contentState: 'unknown',
      }
    );
  }

  private editTextTarget(
    command: Extract<TaskEditCommand, { readonly type: 'edit-link' }>,
    rootRef: TaskRef,
    content: string,
    block: TaskRootBlock,
    relativeLine: number,
    nodeTarget: PlanningTarget | undefined,
  ): { readonly result: TaskRepositoryResult; readonly content: string } {
    const current = this.snapshotFor(rootRef.filePath, content, block);
    const targetNode = nodeTarget ? current && nodeSnapshot(current, nodeTarget) : undefined;
    if (!current || !targetNode) {
      return {
        result: current
          ? { type: 'conflict', current }
          : { type: 'not-found', target: mutationTarget(command) },
        content,
      };
    }
    const lines = content.split(/\r?\n/u);
    let targetRelativeLine: number | undefined;
    let occurrence = command.occurrence;
    if (command.target.type === 'comment') {
      targetRelativeLine = commentRelativeLine(relativeLine, command.target.ref, lines, block.line);
      if (targetRelativeLine === undefined) {
        return { result: { type: 'conflict', current }, content };
      }
    } else if (command.target.type === 'description') {
      for (const candidate of descriptionLines(lines, relativeLine, targetNode, block)) {
        const linkCount = parseLinks(lines[block.line + candidate] ?? '').length;
        if (occurrence < linkCount) {
          targetRelativeLine = candidate;
          break;
        }
        occurrence -= linkCount;
      }
    }
    if (targetRelativeLine === undefined) {
      return {
        result: { type: 'invalid', issues: [{ code: 'invalid-target', field: 'link' }] },
        content,
      };
    }
    const source = lines[block.line + targetRelativeLine] ?? '';
    const editResult = this.options.codec.editTextLink(source, occurrence, command.replacement);
    if (editResult.type === 'invalid') return { result: editResult, content };
    if (editResult.type === 'unchanged') {
      return {
        result: { type: 'committed', outcome: { type: 'task', task: current }, changed: false },
        content,
      };
    }
    const replaced = this.options.editor.replaceLine(
      content,
      block,
      targetRelativeLine,
      editResult.content,
    );
    const task = this.snapshotFor(rootRef.filePath, replaced.content, replaced.block);
    return task
      ? {
          result: { type: 'committed', outcome: { type: 'task', task }, changed: true },
          content: replaced.content,
        }
      : {
          result: { type: 'invalid', issues: [{ code: 'invalid-task-syntax' }] },
          content,
        };
  }

  private snapshotFor(
    path: string,
    content: string,
    block: TaskRootBlock,
  ): TaskSnapshot | undefined {
    const snapshot = this.options
      .snapshotsFromContent(path, content)
      .find((candidate) => candidate.source.line === block.line);
    if (!snapshot) return undefined;
    const ref: TaskRef = {
      filePath: path,
      line: block.line,
      revision: this.options.locator.revision(block.source),
    };
    return rebaseSnapshot(snapshot, ref);
  }

  private candidateFor(
    block: TaskRootBlock,
    command: TaskEditCommand,
    path: string,
    content: string,
  ): TaskResolutionCandidate | undefined {
    const root = this.snapshotFor(path, content, block);
    if (!root) return undefined;
    const original = mutationTarget(command);
    const target =
      original.type === 'comment'
        ? {
            type: 'comment' as const,
            ref: { ...original.ref, parent: rebaseNode(original.ref.parent, root.ref) },
          }
        : rebaseNode(original, root.ref);
    return { root, target };
  }

  private resolutionResult(
    located: Exclude<ReturnType<TaskLocator['locate']>, { readonly type: 'exact' }>,
    command: TaskEditCommand,
    path: string,
    content: string,
  ): TaskRepositoryResult {
    if (located.type === 'not-found') {
      return { type: 'not-found', target: mutationTarget(command) };
    }
    if (located.type === 'conflict') {
      const current = this.snapshotFor(path, content, located.block);
      return current
        ? { type: 'conflict', current }
        : { type: 'not-found', target: mutationTarget(command) };
    }
    const candidates = located.blocks.flatMap((block) => {
      const candidate = this.candidateFor(block, command, path, content);
      return candidate ? [candidate] : [];
    });
    return candidates.length > 0
      ? { type: 'ambiguous', candidates }
      : { type: 'not-found', target: mutationTarget(command) };
  }
}
