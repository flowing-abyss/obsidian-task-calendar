import { TFile, type App } from 'obsidian';

export async function openInFile(
  app: App,
  task: { filePath: string; line: number },
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return;
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(file);
  const view = leaf.view as {
    editor?: { setCursor?: (pos: { line: number; ch: number }) => void };
  };
  view.editor?.setCursor?.({ line: task.line, ch: 0 });
}
