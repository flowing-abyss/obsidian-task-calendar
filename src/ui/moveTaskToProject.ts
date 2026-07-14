import type { App } from 'obsidian';
import type { ProjectManager } from '../projects/ProjectManager';
import type { TaskApplicationApi, TaskCommandResult, TaskRef } from '../tasks';
import { presentTaskMoveResult } from './taskCommandResult';

export async function moveTaskToProjectWithRecovery(
  app: App,
  tasks: TaskApplicationApi,
  projectManager: ProjectManager,
  ref: TaskRef,
  projectPath: string,
): Promise<TaskCommandResult> {
  const result = await projectManager.moveTaskToProject(ref, projectPath);
  presentTaskMoveResult(app, tasks, result);
  return result;
}
