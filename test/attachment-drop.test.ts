import type { App, TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import {
  attachFilesAsLinks,
  defaultPastedName,
  insertAtCaret,
  resolveDraggedItems,
} from '../src/ui/attachmentDrop';

const file = (name: string): File => ({ name }) as unknown as File;
const tfile = (path: string): TFile => ({ path }) as TFile;

describe('defaultPastedName', () => {
  it('derives a filename from the image MIME type', () => {
    expect(defaultPastedName('image/png')).toBe('pasted-image.png');
    expect(defaultPastedName('image/jpeg')).toBe('pasted-image.jpg');
    expect(defaultPastedName('image/svg+xml')).toBe('pasted-image.svg');
  });
  it('falls back to the raw image subtype when unmapped', () => {
    expect(defaultPastedName('image/tiff')).toBe('pasted-image.tiff');
  });
  it('uses pasted-file for non-image blobs', () => {
    expect(defaultPastedName('application/pdf')).toBe('pasted-file');
    expect(defaultPastedName('')).toBe('pasted-file');
  });
});

describe('insertAtCaret', () => {
  const ta = (value: string, start: number, end = start): HTMLTextAreaElement => {
    const el = document.createElement('textarea');
    el.value = value;
    el.setSelectionRange(start, end);
    return el;
  };

  it('inserts into an empty textarea without a leading space', () => {
    const el = ta('', 0);
    insertAtCaret(el, '[[a.png|image]]');
    expect(el.value).toBe('[[a.png|image]]');
  });
  it('adds a separating space after existing non-space text', () => {
    const el = ta('note', 4);
    insertAtCaret(el, '[[a.png|image]]');
    expect(el.value).toBe('note [[a.png|image]]');
  });
  it('inserts at the caret between existing text', () => {
    // value 'a b', caret at index 2 (right after the space) → no extra sep, insert 'X'
    const el = ta('a b', 2);
    insertAtCaret(el, 'X');
    expect(el.value).toBe('a Xb');
  });
});

describe('attachFilesAsLinks', () => {
  it('names a nameless clipboard blob from its MIME type before saving', async () => {
    const bytes = new Uint8Array([1]).buffer;
    const pasted = {
      name: '',
      type: 'image/png',
      arrayBuffer: () => Promise.resolve(bytes),
    } as unknown as File;
    const saved = { name: 'pasted-image.png' } as TFile;
    const app = {
      fileManager: {
        getAvailablePathForAttachment: vi.fn().mockResolvedValue('pasted-image.png'),
        generateMarkdownLink: vi.fn().mockReturnValue('[[pasted-image.png|image]]'),
      },
      vault: { createBinary: vi.fn().mockResolvedValue(saved) },
    } as unknown as App;

    const links = await attachFilesAsLinks(app, [pasted], 'Tasks/T.md');

    expect(app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(
      'pasted-image.png',
      'Tasks/T.md',
    );
    expect(links).toEqual(['[[pasted-image.png|image]]']);
  });
});

describe('resolveDraggedItems', () => {
  it('returns external files when the drop carries OS files', () => {
    const dt = { files: [file('a.png'), file('b.pdf')] } as unknown as DataTransfer;
    const r = resolveDraggedItems(dt, undefined);
    expect(r.externalFiles.map((f) => f.name)).toEqual(['a.png', 'b.pdf']);
    expect(r.vaultFiles).toEqual([]);
  });

  it('falls back to the vault drag manager when there are no OS files', () => {
    const dt = { files: [] } as unknown as DataTransfer;
    const r = resolveDraggedItems(dt, { draggable: { file: tfile('Notes/x.md') } });
    expect(r.externalFiles).toEqual([]);
    expect(r.vaultFiles.map((f) => f.path)).toEqual(['Notes/x.md']);
  });

  it('supports a multi-file vault drag', () => {
    const dt = { files: [] } as unknown as DataTransfer;
    const r = resolveDraggedItems(dt, { draggable: { files: [tfile('a.md'), tfile('b.png')] } });
    expect(r.vaultFiles.map((f) => f.path)).toEqual(['a.md', 'b.png']);
  });

  it('prefers external files over the drag manager when both exist', () => {
    const dt = { files: [file('a.png')] } as unknown as DataTransfer;
    const r = resolveDraggedItems(dt, { draggable: { file: tfile('x.md') } });
    expect(r.externalFiles.map((f) => f.name)).toEqual(['a.png']);
    expect(r.vaultFiles).toEqual([]);
  });

  it('returns empty for a null dataTransfer and no drag manager', () => {
    expect(resolveDraggedItems(null, undefined)).toEqual({ externalFiles: [], vaultFiles: [] });
  });
});
