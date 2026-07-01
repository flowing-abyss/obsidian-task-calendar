import { describe, it, expect } from 'vitest';
import type { TFile } from 'obsidian';
import { resolveDraggedItems } from '../src/ui/attachmentDrop';

const file = (name: string): File => ({ name }) as unknown as File;
const tfile = (path: string): TFile => ({ path }) as TFile;

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
