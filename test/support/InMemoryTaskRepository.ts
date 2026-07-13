import type {
  TaskEditCommand,
  TaskRepository,
  TaskRepositoryResult,
} from '../../src/tasks/application/TaskRepository';
import type { PlanningTarget } from '../../src/tasks/domain/commands';
import type {
  SubtaskRef,
  TaskMutationTarget,
  TaskNodeRef,
  TaskRef,
  TaskSnapshot,
} from '../../src/tasks/domain/types';
import { applyPlanningCommand } from '../../src/tasks/infrastructure/markdown/applyPlanningCommand';
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

function childChain(target: PlanningTarget): readonly SubtaskRef[] {
  const chain: SubtaskRef[] = [];
  let node: TaskNodeRef = target;
  while (node.type === 'subtask') {
    chain.unshift(node.ref);
    node = node.ref.parent;
  }
  return chain;
}

function confirmedLine(target: PlanningTarget, block: string): number | undefined {
  if (target.type === 'task') return 0;
  const rootLines = block.split(/\r?\n/u);
  let line = 0;
  for (const child of childChain(target)) {
    line += child.relativeLine;
    const expected = child.originalBlock.split(/\r?\n/u);
    if (rootLines.slice(line, line + expected.length).join('\n') !== expected.join('\n')) {
      return undefined;
    }
  }
  return line;
}

function targetOf(command: TaskEditCommand): TaskMutationTarget {
  return command.type === 'patch' ? command.target : { type: 'task', ref: command.ref };
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
    const target =
      command.type === 'patch' ? command.target : ({ type: 'task', ref: command.ref } as const);
    const ref = rootRef(target);
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
      return {
        type: 'ambiguous',
        candidates: located.blocks.flatMap((block) => {
          const root = this.snapshot(ref.filePath, content, block.line);
          return root ? [{ root, target: { type: 'task' as const, ref: root.ref } }] : [];
        }),
      };
    }

    const relativeLine = confirmedLine(target, located.block.source);
    if (relativeLine === undefined) {
      const current = this.snapshot(ref.filePath, content, located.block.line);
      return current
        ? { type: 'conflict', current }
        : { type: 'not-found', target: targetOf(command) };
    }
    const lines = content.split(/\r?\n/u);
    const sourceLine = lines[located.block.line + relativeLine];
    if (sourceLine === undefined) return { type: 'not-found', target: targetOf(command) };
    const result = applyPlanningCommand(this.options.codec, sourceLine, command);
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
