import { TFile, type App } from 'obsidian';
import type { TaskRepository, TaskRepositoryResult } from '../../application/TaskRepository';
import type { PlanningTarget, TaskCommand, TaskResolutionCandidate } from '../../domain/commands';
import type {
  SubtaskRef,
  SubtaskSnapshot,
  TaskMutationTarget,
  TaskNodeRef,
  TaskRef,
  TaskSnapshot,
} from '../../domain/types';
import { applyPlanningCommand } from '../markdown/applyPlanningCommand';
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

function childChain(target: PlanningTarget): readonly SubtaskRef[] {
  const chain: SubtaskRef[] = [];
  let node: TaskNodeRef = target;
  while (node.type === 'subtask') {
    chain.unshift(node.ref);
    node = node.ref.parent;
  }
  return chain;
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
    const expected = child.originalBlock.split(/\r?\n/u);
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

function mutationTarget(command: TaskCommand): TaskMutationTarget {
  return command.type === 'patch' ? command.target : { type: 'task', ref: command.ref };
}

export class ObsidianTaskRepository implements TaskRepository {
  constructor(
    private readonly app: App,
    private readonly options: RepositoryOptions,
  ) {}

  async edit(command: TaskCommand): Promise<TaskRepositoryResult> {
    const rootRef = command.type === 'patch' ? rootRefOf(command.target) : command.ref;
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

        const relativeLine =
          command.type === 'patch' ? confirmedTargetRelativeLine(command.target, located.block) : 0;
        if (relativeLine === undefined) {
          const current = this.snapshotFor(rootRef.filePath, content, located.block);
          result = current
            ? { type: 'conflict', current }
            : { type: 'not-found', target: mutationTarget(command) };
          return content;
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

        const editResult = applyPlanningCommand(this.options.codec, sourceLine, command);
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
    command: TaskCommand,
    path: string,
    content: string,
  ): TaskResolutionCandidate | undefined {
    const root = this.snapshotFor(path, content, block);
    if (!root) return undefined;
    const original = mutationTarget(command);
    const target = original.type === 'comment' ? original : rebaseNode(original, root.ref);
    return { root, target };
  }

  private resolutionResult(
    located: Exclude<ReturnType<TaskLocator['locate']>, { readonly type: 'exact' }>,
    command: TaskCommand,
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
