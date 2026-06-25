import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { openInFile } from '../src/ui/taskNavigation';
import { createAppWithFiles } from './helpers';

describe('openInFile', () => {
  it('opens file and sets cursor to task line', async () => {
    const app = await createAppWithFiles({ 'note.md': '- [ ] task\n- [ ] other\n' });
    const setCursor = vi.fn();
    const leaf = {
      openFile: vi.fn().mockResolvedValue(undefined),
      view: { editor: { setCursor } },
    };
    vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(leaf as never);

    const task = { filePath: 'note.md', line: 1 };
    await openInFile(app, task);

    expect(leaf.openFile).toHaveBeenCalledWith(expect.any(TFile));
    expect(setCursor).toHaveBeenCalledWith({ line: 1, ch: 0 });
  });

  it('does nothing when filePath is not a TFile', async () => {
    const app = await createAppWithFiles({});
    const getLeaf = vi.spyOn(app.workspace, 'getLeaf');
    await openInFile(app, { filePath: 'missing.md', line: 0 });
    expect(getLeaf).not.toHaveBeenCalled();
  });
});
