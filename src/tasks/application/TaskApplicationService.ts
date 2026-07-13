import type { TaskCommand, TaskCommandResult } from '../domain/commands';
import type { TaskApplicationApi, TaskQueryApi } from './TaskApplicationApi';
import type { TaskRepository } from './TaskRepository';

export class TaskApplicationService implements TaskApplicationApi {
  constructor(
    readonly queries: TaskQueryApi,
    private readonly repository: TaskRepository,
  ) {}

  async execute(command: TaskCommand): Promise<TaskCommandResult> {
    try {
      const result = await this.repository.edit(command);
      if (result.type === 'committed') {
        return { type: 'ok', outcome: result.outcome, changed: result.changed };
      }
      return result;
    } catch {
      return { type: 'io-error', cause: 'repository-error', contentState: 'unknown' };
    }
  }
}
