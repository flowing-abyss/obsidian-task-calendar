import { describe, expect, it } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';

describe('buildDefaultTaskStatuses', () => {
  it('seeds the 4 core statuses plus important/question', () => {
    const s = buildDefaultTaskStatuses();
    const bySymbol = Object.fromEntries(s.map((d) => [d.symbol, d]));
    expect(bySymbol[' ']!.type).toBe('todo');
    expect(bySymbol[' ']!.core).toBe(true);
    expect(bySymbol['/']!.type).toBe('in-progress');
    expect(bySymbol['x']!.type).toBe('done');
    expect(bySymbol['x']!.core).toBe(true);
    expect(bySymbol['-']!.type).toBe('cancelled');
    expect(bySymbol['!']!.core).toBe(false);
    expect(bySymbol['?']!.core).toBe(false);
  });

  it('gives every status a unique id and single-char symbol', () => {
    const s = buildDefaultTaskStatuses();
    const ids = new Set(s.map((d) => d.id));
    expect(ids.size).toBe(s.length);
    for (const d of s) expect([...d.symbol].length).toBe(1);
  });

  it('marks exactly the 4 backbone types as core', () => {
    const core = buildDefaultTaskStatuses().filter((d) => d.core);
    expect(core.map((d) => d.type).sort()).toEqual(['cancelled', 'done', 'in-progress', 'todo']);
  });

  it('has no color or iconKind fields; icons are lucide ids only', () => {
    const s = buildDefaultTaskStatuses();
    for (const d of s) {
      expect((d as unknown as Record<string, unknown>)['color']).toBeUndefined();
      expect((d as unknown as Record<string, unknown>)['iconKind']).toBeUndefined();
    }
    const bySymbol = Object.fromEntries(s.map((d) => [d.symbol, d]));
    expect(bySymbol[' ']!.icon).toBe('');
    expect(bySymbol['/']!.icon).toBe('play');
    expect(bySymbol['x']!.icon).toBe('check');
    expect(bySymbol['-']!.icon).toBe('x');
    expect(bySymbol['!']!.icon).toBe('alert-triangle');
    expect(bySymbol['?']!.icon).toBe('help-circle');
  });
});
