import { describe, expect, it } from 'vitest';
import { TaskBlockEditor } from '../../src/tasks/infrastructure/markdown/TaskBlockEditor';
import { TaskLocator } from '../../src/tasks/infrastructure/markdown/TaskLocator';

describe('TaskBlockEditor', () => {
  it('keeps the complete root aggregate and CRLF when replacing its task line', () => {
    const editor = new TaskBlockEditor();
    const source = '- [ ] root\r\n  - description\r\n  - [ ] child\r\n- [ ] next\r\n';
    const blocks = editor.rootBlocks(source);

    expect(blocks.map((block) => block.source)).toEqual([
      '- [ ] root\r\n  - description\r\n  - [ ] child',
      '- [ ] next',
    ]);
    expect(editor.replaceLine(source, blocks[0]!, 0, '- [ ] changed').content).toBe(
      '- [ ] changed\r\n  - description\r\n  - [ ] child\r\n- [ ] next\r\n',
    );
  });

  it('ends a root revision at the first non-child structural boundary', () => {
    const editor = new TaskBlockEditor();
    const blocks = editor.rootBlocks('- [ ] root\n  - [ ] child\n## heading\n- [ ] next\n');

    expect(blocks.map((block) => block.source)).toEqual([
      '- [ ] root\n  - [ ] child',
      '- [ ] next',
    ]);
  });
});

describe('TaskLocator', () => {
  it('uses the line hint, recovers unique drift, and reports duplicate exact blocks as ambiguous', () => {
    const locator = new TaskLocator(() => 'same-fingerprint');
    const editor = new TaskBlockEditor();
    const original = editor.rootBlocks('- [ ] wanted\n')[0]!;
    const ref = { filePath: 'tasks.md', line: 0, revision: locator.revision(original.source) };

    expect(locator.locate(editor.rootBlocks('- [ ] wanted\n'), ref)).toMatchObject({
      type: 'exact',
    });
    expect(locator.locate(editor.rootBlocks('heading\n- [ ] wanted\n'), ref)).toMatchObject({
      type: 'exact',
      block: { line: 1 },
    });
    expect(locator.locate(editor.rootBlocks('- [ ] wanted\n- [ ] wanted\n'), ref)).toMatchObject({
      type: 'ambiguous',
      blocks: [{ line: 0 }, { line: 1 }],
    });
  });

  it('never authorizes a write from a colliding fingerprint without exact source confirmation', () => {
    const locator = new TaskLocator(() => 'collision');
    const editor = new TaskBlockEditor();
    const first = editor.rootBlocks('- [ ] first\n')[0]!;
    const second = editor.rootBlocks('- [ ] second\n')[0]!;
    const ref = { filePath: 'tasks.md', line: 0, revision: locator.revision(first.source) };

    expect(locator.revision(first.source)).not.toBe(locator.revision(second.source));
    expect(locator.locate([second], ref)).toEqual({ type: 'conflict', block: second });
  });
});
