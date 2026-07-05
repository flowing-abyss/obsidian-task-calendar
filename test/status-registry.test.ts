import { describe, expect, it } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';

const reg = () => new StatusRegistry(buildDefaultTaskStatuses());

describe('StatusRegistry', () => {
  it('maps symbols to types', () => {
    const r = reg();
    expect(r.typeForSymbol(' ')).toBe('open');
    expect(r.typeForSymbol('/')).toBe('in-progress');
    expect(r.typeForSymbol('x')).toBe('done');
    expect(r.typeForSymbol('-')).toBe('cancelled');
  });

  it('treats uppercase X as an alias for lowercase x (done)', () => {
    expect(reg().typeForSymbol('X')).toBe('done');
  });

  it('bySymbol folds uppercase X to the same Done def as lowercase x', () => {
    const r = reg();
    const upper = r.bySymbol('X');
    const lower = r.bySymbol('x');
    expect(upper).toBeDefined();
    expect(upper).toBe(lower);
    expect(upper?.type).toBe('done');
  });

  it('falls back to open for unknown symbols', () => {
    expect(reg().typeForSymbol('@')).toBe('open');
    expect(reg().bySymbol('@')).toBeUndefined();
  });

  it('resolves default todo and done by core+type', () => {
    const r = reg();
    expect(r.defaultTodo().symbol).toBe(' ');
    expect(r.defaultDone().symbol).toBe('x');
  });

  it('groups in fixed type order', () => {
    const groups = reg()
      .grouped()
      .map((g) => g.type);
    expect(groups).toEqual(['todo', 'in-progress', 'done', 'cancelled']);
  });

  it('orders by settings order for sorting; unknown last', () => {
    const r = reg();
    expect(r.orderIndex(' ')).toBeLessThan(r.orderIndex('x'));
    expect(r.orderIndex('@')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('orderIndex folds uppercase X to the same slot as lowercase x', () => {
    const r = reg();
    expect(r.orderIndex('X')).toBe(r.orderIndex('x'));
    expect(r.orderIndex('X')).toBeLessThan(r.orderIndex('@'));
  });
});
