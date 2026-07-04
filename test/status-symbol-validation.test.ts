import { describe, it, expect } from 'vitest';
import { validateStatusSymbol } from '../src/settings/SettingsTab';

const list = [
  { id: 'a', symbol: 'x' },
  { id: 'b', symbol: '!' },
] as any;

describe('validateStatusSymbol', () => {
  it('requires exactly one character', () => {
    expect(validateStatusSymbol('', list, 'c')).toMatch(/one character/i);
    expect(validateStatusSymbol('ab', list, 'c')).toMatch(/one character/i);
  });
  it('rejects duplicates against other statuses', () => {
    expect(validateStatusSymbol('x', list, 'c')).toMatch(/already/i);
  });
  it('allows keeping a status own symbol', () => {
    expect(validateStatusSymbol('x', list, 'a')).toBeNull();
  });
  it('accepts a fresh single char', () => {
    expect(validateStatusSymbol('>', list, 'c')).toBeNull();
  });
});
