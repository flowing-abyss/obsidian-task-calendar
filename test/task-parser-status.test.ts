import { describe, it, expect } from 'vitest';
import { parseTask } from '../src/parser/TaskParser';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';

const registry = new StatusRegistry(buildDefaultTaskStatuses());
const ctx = (line = 0) => ({ filePath: 'n.md', line, statusRegistry: registry });

describe('parseTask status', () => {
  it('parses each default symbol to type + statusSymbol', () => {
    expect(parseTask('- [ ] a', ctx())?.status).toBe('open');
    expect(parseTask('- [ ] a', ctx())?.statusSymbol).toBe(' ');
    expect(parseTask('- [/] a', ctx())?.status).toBe('in-progress');
    expect(parseTask('- [x] a', ctx())?.status).toBe('done');
    expect(parseTask('- [X] a', ctx())?.status).toBe('done'); // uppercase done still resolves
    expect(parseTask('- [-] a', ctx())?.status).toBe('cancelled');
    expect(parseTask('- [!] a', ctx())?.statusSymbol).toBe('!');
    expect(parseTask('- [!] a', ctx())?.status).toBe('open');
  });

  it('unknown symbol falls back to open but keeps the raw glyph', () => {
    const t = parseTask('- [@] weird', ctx());
    expect(t?.status).toBe('open');
    expect(t?.statusSymbol).toBe('@');
  });

  it('parses statuses in blockquote/callout-nested tasks', () => {
    const t = parseTask('> - [!] nested', ctx());
    expect(t?.statusSymbol).toBe('!');
    expect(t?.status).toBe('open');
  });

  it('keeps ❌ date → cancelled override', () => {
    const t = parseTask('- [ ] a ❌ 2026-01-02', ctx());
    expect(t?.status).toBe('cancelled');
  });

  it('regex-metacharacter symbols do not break parsing', () => {
    expect(parseTask('- [*] star', ctx())?.statusSymbol).toBe('*');
    expect(parseTask('- [>] fwd', ctx())?.statusSymbol).toBe('>');
  });
});
