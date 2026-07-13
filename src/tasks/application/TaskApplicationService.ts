import { cloneTaskSnapshot } from '../domain/cloneTaskSnapshot';
import type { Clock, TaskCommand, TaskCommandResult, TaskStatusTarget } from '../domain/commands';
import { StatusCatalog } from '../domain/StatusCatalog';
import type {
  SubtaskRef,
  SubtaskSnapshot,
  TaskNodeRef,
  TaskRef,
  TaskSnapshot,
  TaskStatus,
} from '../domain/types';
import type { TaskApplicationApi, TaskQueryApi } from './TaskApplicationApi';
import type { TaskEditCommand, TaskRepository } from './TaskRepository';

function rootRefOf(target: TaskStatusTarget): TaskRef {
  let node: TaskNodeRef = target;
  while (node.type === 'subtask') node = node.ref.parent;
  return node.ref;
}

function childChain(target: TaskStatusTarget): readonly SubtaskRef[] {
  const chain: SubtaskRef[] = [];
  let node: TaskNodeRef = target;
  while (node.type === 'subtask') {
    chain.unshift(node.ref);
    node = node.ref.parent;
  }
  return chain;
}

function rebaseStatusTarget(target: TaskStatusTarget, root: TaskRef): TaskStatusTarget {
  if (target.type === 'task') return { type: 'task', ref: root };
  return {
    type: 'subtask',
    ref: {
      ...target.ref,
      parent: rebaseStatusTarget(target.ref.parent, root),
    },
  };
}

function snapshotForTarget(
  root: TaskSnapshot,
  target: TaskStatusTarget,
): TaskSnapshot | SubtaskSnapshot | undefined {
  if (target.type === 'task') return root;
  let current: TaskSnapshot | SubtaskSnapshot = root;
  for (const ref of childChain(target)) {
    const next: SubtaskSnapshot | undefined = current.subtasks.find(
      (candidate) =>
        candidate.ref.relativeLine === ref.relativeLine &&
        candidate.ref.originalBlock === ref.originalBlock,
    );
    if (!next) return undefined;
    current = next;
  }
  return current;
}

function statusForRuleType(type: 'todo' | 'in-progress' | 'done' | 'cancelled'): TaskStatus {
  return type === 'todo' ? 'open' : type;
}

function refKey(ref: TaskRef): string {
  return `${ref.filePath}\0${ref.line}\0${ref.revision}`;
}

const RECENT_OUTCOME_LIMIT = 64;

export class TaskApplicationService implements TaskApplicationApi {
  // Bridges the index-event lag only for exact refs returned by this service. The cache shares the
  // service lifetime and is bounded so revision churn cannot retain an unbounded snapshot history.
  private readonly recentOutcomes = new Map<string, TaskSnapshot>();

  constructor(
    readonly queries: TaskQueryApi,
    private readonly repository: TaskRepository,
    private readonly statusCatalog: StatusCatalog,
    private readonly clock: Clock,
  ) {}

  async execute(command: TaskCommand): Promise<TaskCommandResult> {
    try {
      const prepared = this.prepare(command);
      if ('result' in prepared) return prepared.result;
      const result = await this.repository.edit(prepared.command);
      if (result.type === 'committed') {
        this.remember(result.outcome.task);
        return { type: 'ok', outcome: result.outcome, changed: result.changed };
      }
      return result;
    } catch {
      return { type: 'io-error', cause: 'repository-error', contentState: 'unknown' };
    }
  }

  private prepare(
    command: TaskCommand,
  ): { readonly command: TaskEditCommand } | { readonly result: TaskCommandResult } {
    if (command.type !== 'set-status' && command.type !== 'toggle-completion') {
      return { command };
    }

    const requestedRule =
      command.type === 'set-status' ? this.statusCatalog.ruleForSymbol(command.symbol) : undefined;
    if (command.type === 'set-status' && !requestedRule) {
      return {
        result: {
          type: 'invalid',
          issues: [{ code: 'invalid-status', field: 'status' }],
        },
      };
    }

    const rootRef = rootRefOf(command.target);
    const recent = this.recentOutcomes.get(refKey(rootRef));
    const resolution = recent
      ? { type: 'exact' as const, task: recent }
      : this.queries.resolve(rootRef);
    if (resolution.type === 'conflict') return { result: resolution };
    if (resolution.type === 'not-found') {
      return { result: { type: 'not-found', target: command.target } };
    }
    if (resolution.type === 'ambiguous') {
      return {
        result: {
          type: 'ambiguous',
          candidates: resolution.candidates.map((candidate) => ({
            root: candidate.root,
            target: rebaseStatusTarget(command.target, candidate.root.ref),
          })),
        },
      };
    }
    const current = snapshotForTarget(resolution.task, command.target);
    if (!current) return { result: { type: 'conflict', current: resolution.task } };
    const currentRule = this.statusCatalog.ruleForSymbol(current.statusSymbol);
    const currentSemanticStatus = currentRule
      ? statusForRuleType(currentRule.type)
      : this.statusCatalog.statusForSymbol(current.statusSymbol);

    let rule;
    if (command.type === 'set-status') {
      rule = requestedRule!;
    } else {
      const targetType = currentSemanticStatus === 'done' ? 'todo' : 'done';
      rule = this.statusCatalog.defaultForType(targetType);
      if (!rule) {
        return {
          result: {
            type: 'invalid',
            issues: [{ code: 'invalid-status', field: 'status' }],
          },
        };
      }
    }

    const sameConfiguredStatus = currentRule?.symbol === rule.symbol;
    const entersStampedState =
      currentSemanticStatus !== statusForRuleType(rule.type) &&
      (rule.type === 'done' || rule.type === 'cancelled');
    return {
      command: {
        type: 'set-status',
        target: command.target,
        symbol: sameConfiguredStatus ? current.statusSymbol : rule.symbol,
        ...(entersStampedState && { stamp: this.clock.today() }),
      },
    };
  }

  private remember(task: TaskSnapshot): void {
    const key = refKey(task.ref);
    this.recentOutcomes.delete(key);
    this.recentOutcomes.set(key, cloneTaskSnapshot(task));
    if (this.recentOutcomes.size <= RECENT_OUTCOME_LIMIT) return;
    const oldest = this.recentOutcomes.keys().next().value;
    if (oldest !== undefined) this.recentOutcomes.delete(oldest);
  }
}
