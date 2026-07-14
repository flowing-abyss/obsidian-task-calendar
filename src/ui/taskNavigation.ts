import { TFile, type App } from 'obsidian';
import type { TaskSnapshot } from '../tasks';

export async function openInFile(
  app: App,
  task: TaskSnapshot,
  line = task.source.line,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.source.filePath);
  if (!(file instanceof TFile)) return;
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(file);
  const view = leaf.view as {
    editor?: { setCursor?: (pos: { line: number; ch: number }) => void };
  };
  view.editor?.setCursor?.({ line, ch: 0 });
}
