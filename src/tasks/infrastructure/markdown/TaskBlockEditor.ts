const TASK_RE = /^[\s>]*- \[(.)\]/u;
const PREFIX_RE = /^([\s>]*)/u;

export interface TaskRootBlock {
  readonly line: number;
  readonly toLine: number;
  readonly source: string;
}

interface SourceLine {
  readonly text: string;
  readonly ending: '' | '\n' | '\r\n';
  readonly from: number;
  readonly to: number;
}

function sourceLines(content: string): SourceLine[] {
  const result: SourceLine[] = [];
  let from = 0;
  while (from < content.length) {
    const newline = content.indexOf('\n', from);
    const to = newline < 0 ? content.length : newline + 1;
    const hasCrLf = newline > from && content[newline - 1] === '\r';
    let textTo = content.length;
    let ending: SourceLine['ending'] = '';
    if (newline >= 0) {
      textTo = newline - (hasCrLf ? 1 : 0);
      ending = hasCrLf ? '\r\n' : '\n';
    }
    result.push({ text: content.slice(from, textTo), ending, from, to });
    from = to;
  }
  return result;
}

function indentation(line: string): number {
  const prefix = PREFIX_RE.exec(line)?.[1] ?? '';
  return prefix.replace(/>/gu, ' ').replace(/\t/gu, '    ').length;
}

function quoteDepth(line: string): number {
  return [...(PREFIX_RE.exec(line)?.[1] ?? '')].filter((character) => character === '>').length;
}

export class TaskBlockEditor {
  rootBlocks(content: string): readonly TaskRootBlock[] {
    const lines = sourceLines(content);
    const roots: TaskRootBlock[] = [];
    let index = 0;
    while (index < lines.length) {
      const rootLine = lines[index];
      if (!rootLine || !TASK_RE.test(rootLine.text)) {
        index++;
        continue;
      }
      const rootIndent = indentation(rootLine.text);
      const rootQuote = quoteDepth(rootLine.text);
      let toLine = index;
      let cursor = index + 1;
      while (cursor < lines.length) {
        const line = lines[cursor];
        if (!line) break;
        if (/^[\s>]*$/u.test(line.text)) {
          cursor++;
          continue;
        }
        if (quoteDepth(line.text) !== rootQuote || indentation(line.text) <= rootIndent) break;
        toLine = cursor;
        cursor++;
      }
      const from = rootLine.from;
      const last = lines[toLine];
      const to = last ? last.to - last.ending.length : from;
      roots.push({
        line: index,
        toLine,
        source: content.slice(from, to),
      });
      index = Math.max(index + 1, cursor);
    }
    return roots;
  }

  replaceLine(
    content: string,
    block: TaskRootBlock,
    relativeLine: number,
    replacement: string,
  ): { readonly content: string; readonly block: TaskRootBlock } {
    const lines = sourceLines(content);
    const absoluteLine = block.line + relativeLine;
    const current = lines[absoluteLine];
    if (!current || absoluteLine > block.toLine) return { content, block };
    const next =
      content.slice(0, current.from) + replacement + current.ending + content.slice(current.to);
    const updated =
      this.rootBlocks(next).find((candidate) => candidate.line === block.line) ?? block;
    return { content: next, block: updated };
  }
}
