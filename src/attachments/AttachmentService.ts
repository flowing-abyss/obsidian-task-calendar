import type { App, TFile } from 'obsidian';

export type AttachmentAlias = 'image' | 'PDF' | 'doc' | 'table' | 'file';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const DOC_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'rtf', 'pages']);
const TABLE_EXTENSIONS = new Set(['xls', 'xlsx', 'xlsm', 'csv', 'ods', 'numbers']);

/** Map a file extension (dot optional, case-insensitive) to a compact alias. */
export function aliasForExtension(extension: string): AttachmentAlias {
  const ext = extension.replace(/^\./u, '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'pdf') return 'PDF';
  if (DOC_EXTENSIONS.has(ext)) return 'doc';
  if (TABLE_EXTENSIONS.has(ext)) return 'table';
  return 'file';
}

/** Derive the alias from a filename (uses the substring after the last dot). */
export function aliasForName(name: string): AttachmentAlias {
  const dot = name.lastIndexOf('.');
  return aliasForExtension(dot >= 0 ? name.slice(dot + 1) : '');
}

/** Save an external (OS) File into Obsidian's configured attachment location. */
export async function saveExternalFile(app: App, file: File, sourcePath: string): Promise<TFile> {
  const path = await app.fileManager.getAvailablePathForAttachment(file.name, sourcePath);
  const bytes = await file.arrayBuffer();
  return app.vault.createBinary(path, bytes);
}

/** Build a compact, non-embed link honoring the vault's link-style setting. */
export function buildAttachmentLink(
  app: App,
  file: TFile,
  sourcePath: string,
  alias: AttachmentAlias,
): string {
  return app.fileManager.generateMarkdownLink(file, sourcePath, undefined, alias);
}
