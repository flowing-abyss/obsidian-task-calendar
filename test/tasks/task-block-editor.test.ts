import { describe, expect, it } from 'vitest';
import { localDate } from '../../src/tasks/domain/validation';
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

  it('applies structural edits synchronously while preserving the file newline boundary', () => {
    const editor = new TaskBlockEditor();
    const source = '- [ ] root\n  - > description';
    const block = editor.rootBlocks(source)[0]!;
    const target = {
      relativeLine: 0,
      lineCount: 2,
      childRanges: [],
      description: 'description',
    };

    const cleared = editor.edit(source, block, target, {
      type: 'set-description',
      text: null,
    });
    expect(cleared).toMatchObject({ type: 'changed', content: '- [ ] root' });

    const changed = cleared.type === 'changed' ? cleared : undefined;
    const added = editor.edit(
      changed!.content,
      changed!.block,
      { relativeLine: 0, lineCount: 1, childRanges: [] },
      { type: 'add-comment', text: 'note', stamp: localDate('2026-07-14') },
    );
    expect(added).toMatchObject({
      type: 'changed',
      content: '- [ ] root\n  - 2026-07-14: note',
    });
  });

  it('refuses a comment edit when relative-line and original-Markdown evidence disagree', () => {
    const editor = new TaskBlockEditor();
    const source = '- [ ] root\r\n  - 2026-07-13: duplicate\r\n  - 2026-07-13: duplicate\r\n';
    const block = editor.rootBlocks(source)[0]!;
    const result = editor.edit(
      source,
      block,
      { relativeLine: 0, lineCount: 3, childRanges: [] },
      {
        type: 'update-comment',
        relativeLine: 2,
        originalMarkdown: '  - 2026-07-13: stale\r',
        text: 'replacement',
      },
    );

    expect(result).toEqual({ type: 'conflict' });
  });

  it('adds a quoted child without changing CRLF or the missing final newline', () => {
    const editor = new TaskBlockEditor();
    const source = '>\t- [ ] root\r\n>\t  - [ ] existing';
    const block = editor.rootBlocks(source)[0]!;
    const result = editor.edit(
      source,
      block,
      { relativeLine: 0, lineCount: 2, childRanges: [{ from: 1, to: 1 }] },
      { type: 'add-subtask', text: 'new [[child]]' },
    );

    expect(result).toMatchObject({
      type: 'changed',
      content: '>\t- [ ] root\r\n>\t  - [ ] existing\r\n>\t  - [ ] new [[child]]',
    });
  });

  it('deletes the exact duplicate child and all of its descendants', () => {
    const editor = new TaskBlockEditor();
    const source =
      '- [ ] root\n' + '  - [ ] duplicate\n' + '    - [ ] descendant\n' + '  - [ ] duplicate\n';
    const block = editor.rootBlocks(source)[0]!;
    const result = editor.edit(
      source,
      block,
      {
        relativeLine: 0,
        lineCount: 4,
        childRanges: [
          { from: 1, to: 2 },
          { from: 3, to: 3 },
        ],
      },
      {
        type: 'delete-subtask',
        relativeLine: 1,
        originalBlock: '  - [ ] duplicate\n    - [ ] descendant',
      },
    );

    expect(result).toMatchObject({
      type: 'changed',
      content: '- [ ] root\n  - [ ] duplicate\n',
    });
  });

  it('reorders only exact immediate-child blocks and preserves mixed indentation', () => {
    const editor = new TaskBlockEditor();
    const source =
      '- [ ] root\r\n' + '\t- [ ] first\r\n' + '\t  - [ ] nested\r\n' + '    - [ ] second\r\n';
    const block = editor.rootBlocks(source)[0]!;
    const result = editor.edit(
      source,
      block,
      {
        relativeLine: 0,
        lineCount: 4,
        childRanges: [
          { from: 1, to: 2 },
          { from: 3, to: 3 },
        ],
      },
      {
        type: 'reorder-subtask',
        source: {
          relativeLine: 1,
          originalBlock: '\t- [ ] first\r\n\t  - [ ] nested',
        },
        target: { relativeLine: 3, originalBlock: '    - [ ] second' },
        placement: 'after',
      },
    );

    expect(result).toMatchObject({
      type: 'changed',
      content:
        '- [ ] root\r\n' + '    - [ ] second\r\n' + '\t- [ ] first\r\n' + '\t  - [ ] nested\r\n',
    });
  });

  it('refuses structural edits whose exact child evidence is stale', () => {
    const editor = new TaskBlockEditor();
    const source = '- [ ] root\n  - [ ] current\n';
    const block = editor.rootBlocks(source)[0]!;

    expect(
      editor.edit(
        source,
        block,
        { relativeLine: 0, lineCount: 2, childRanges: [{ from: 1, to: 1 }] },
        { type: 'delete-subtask', relativeLine: 1, originalBlock: '  - [ ] stale' },
      ),
    ).toEqual({ type: 'conflict' });
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
