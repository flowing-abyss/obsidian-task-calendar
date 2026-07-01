import { Notice, type App, type TFile } from 'obsidian';
import {
  aliasForName,
  buildAttachmentLink,
  saveExternalFile,
} from '../attachments/AttachmentService';

export interface DraggedItems {
  externalFiles: File[];
  vaultFiles: TFile[];
}

export interface DragManagerLike {
  draggable?: { file?: TFile; files?: TFile[] } | null;
}

/** Split a drop into external OS files (to be saved) vs. existing vault files (link only). */
export function resolveDraggedItems(
  dataTransfer: Pick<DataTransfer, 'files'> | null,
  dragManager: DragManagerLike | undefined,
): DraggedItems {
  const externalFiles = dataTransfer?.files ? Array.from(dataTransfer.files) : [];
  if (externalFiles.length > 0) return { externalFiles, vaultFiles: [] };
  const dragged = dragManager?.draggable;
  const vaultFiles = dragged?.files ?? (dragged?.file ? [dragged.file] : []);
  return { externalFiles: [], vaultFiles };
}

export interface AttachmentDropOptions {
  app: App;
  sourcePath: string;
  onLinks: (linkMarkdown: string) => void;
}

interface AppWithDragManager {
  dragManager?: DragManagerLike;
}

function hasDraggableFiles(app: App): boolean {
  const dm = (app as unknown as AppWithDragManager).dragManager;
  return !!(dm?.draggable?.file || dm?.draggable?.files?.length);
}

/** Wire drag/drop file attachment onto `el`. Returns a disposer that removes the listeners. */
export function enableAttachmentDrop(el: HTMLElement, opts: AttachmentDropOptions): () => void {
  const onDragOver = (e: DragEvent): void => {
    const hasFiles = (e.dataTransfer?.types ?? []).includes('Files');
    if (!hasFiles && !hasDraggableFiles(opts.app)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    el.addClass('tc-drop-active');
  };

  const onDragLeave = (e: DragEvent): void => {
    if (!el.contains(e.relatedTarget as Node)) el.removeClass('tc-drop-active');
  };

  const onDrop = (e: DragEvent): void => {
    const { externalFiles, vaultFiles } = resolveDraggedItems(
      e.dataTransfer,
      (opts.app as unknown as AppWithDragManager).dragManager,
    );
    if (externalFiles.length === 0 && vaultFiles.length === 0) {
      el.removeClass('tc-drop-active');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    el.removeClass('tc-drop-active');
    void handleDrop(el, opts, externalFiles, vaultFiles);
  };

  el.addEventListener('dragover', onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop', onDrop);
  return () => {
    el.removeEventListener('dragover', onDragOver);
    el.removeEventListener('dragleave', onDragLeave);
    el.removeEventListener('drop', onDrop);
  };
}

async function handleDrop(
  el: HTMLElement,
  opts: AttachmentDropOptions,
  externalFiles: File[],
  vaultFiles: TFile[],
): Promise<void> {
  const links: string[] = [];
  // Save external files sequentially so getAvailablePathForAttachment resolves collisions.
  for (const file of externalFiles) {
    try {
      const saved = await saveExternalFile(opts.app, file, opts.sourcePath);
      links.push(buildAttachmentLink(opts.app, saved, opts.sourcePath, aliasForName(saved.name)));
    } catch (err) {
      new Notice(`Could not attach ${file.name}: ${err instanceof Error ? err.message : 'error'}`);
    }
  }
  for (const file of vaultFiles) {
    links.push(buildAttachmentLink(opts.app, file, opts.sourcePath, aliasForName(file.name)));
  }
  if (links.length === 0) return;
  opts.onLinks(links.join(' '));
  new Notice(`Attached ${links.length} file${links.length > 1 ? 's' : ''}`);
}
