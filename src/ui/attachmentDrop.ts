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
    void handleDrop(opts, externalFiles, vaultFiles);
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

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/** A filename for a clipboard blob that has no name of its own (e.g. a pasted screenshot). */
export function defaultPastedName(mimeType: string): string {
  const known = MIME_EXTENSION[mimeType];
  const ext = known ?? (mimeType.startsWith('image/') ? mimeType.slice('image/'.length) : '');
  return ext ? `pasted-image.${ext}` : 'pasted-file';
}

/** Save external/clipboard files sequentially and return their compact link markdown. */
export async function attachFilesAsLinks(
  app: App,
  files: File[],
  sourcePath: string,
): Promise<string[]> {
  const links: string[] = [];
  // Sequential so getAvailablePathForAttachment resolves name collisions deterministically.
  for (const file of files) {
    try {
      const name = file.name || defaultPastedName(file.type);
      const saved = await saveExternalFile(app, file, sourcePath, name);
      links.push(buildAttachmentLink(app, saved, sourcePath, aliasForName(saved.name)));
    } catch (err) {
      new Notice(
        `Could not attach ${file.name || 'pasted file'}: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  }
  return links;
}

/** Insert text at the textarea's caret (with a leading space if needed) and refocus. */
export function insertAtCaret(textarea: HTMLTextAreaElement, text: string): void {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const sep = before && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : '';
  textarea.value = `${before}${sep}${text}${after}`;
  const pos = before.length + sep.length + text.length;
  textarea.setSelectionRange(pos, pos);
  textarea.focus();
}

async function handleDrop(
  opts: AttachmentDropOptions,
  externalFiles: File[],
  vaultFiles: TFile[],
): Promise<void> {
  const links = await attachFilesAsLinks(opts.app, externalFiles, opts.sourcePath);
  for (const file of vaultFiles) {
    links.push(buildAttachmentLink(opts.app, file, opts.sourcePath, aliasForName(file.name)));
  }
  if (links.length === 0) return;
  opts.onLinks(links.join(' '));
  new Notice(`Attached ${links.length} file${links.length > 1 ? 's' : ''}`);
}

export interface AttachmentPasteOptions {
  app: App;
  sourcePath: string;
  onInsert: (linkMarkdown: string) => void;
}

/** Wire clipboard paste-to-attach onto a textarea. Returns a disposer. */
export function enableAttachmentPaste(el: HTMLElement, opts: AttachmentPasteOptions): () => void {
  const onPaste = (e: ClipboardEvent): void => {
    const files = e.clipboardData ? Array.from(e.clipboardData.files) : [];
    if (files.length === 0) return; // no files → let the normal (text) paste happen
    e.preventDefault();
    e.stopPropagation();
    void attachFilesAsLinks(opts.app, files, opts.sourcePath).then((links) => {
      if (links.length === 0) return;
      opts.onInsert(links.join(' '));
      new Notice(`Attached ${links.length} file${links.length > 1 ? 's' : ''}`);
    });
  };
  el.addEventListener('paste', onPaste);
  return () => el.removeEventListener('paste', onPaste);
}
