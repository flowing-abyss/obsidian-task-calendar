import { describe, expect, it } from 'vitest';
import {
  mixHexColors,
  relativeLuminanceOfHex,
  tagFillTextVariant,
} from '../src/tags/tagFillContrast';

describe('relativeLuminanceOfHex', () => {
  it('classifies known light colors as high luminance', () => {
    expect(relativeLuminanceOfHex('#ffffff')).toBeCloseTo(1, 2);
    // Pale yellow
    expect(relativeLuminanceOfHex('#fff8b0')!).toBeGreaterThan(0.8);
  });

  it('classifies known dark colors as low luminance', () => {
    expect(relativeLuminanceOfHex('#000000')).toBeCloseTo(0, 2);
    // Navy
    expect(relativeLuminanceOfHex('#000080')!).toBeLessThan(0.1);
  });

  it('supports 3-digit hex shorthand', () => {
    expect(relativeLuminanceOfHex('#fff')).toBeCloseTo(1, 2);
    expect(relativeLuminanceOfHex('#000')).toBeCloseTo(0, 2);
  });

  it('returns null for unparseable input', () => {
    expect(relativeLuminanceOfHex('not-a-color')).toBeNull();
    expect(relativeLuminanceOfHex('')).toBeNull();
  });
});

describe('mixHexColors', () => {
  it('replicates a simple channel-wise srgb mix', () => {
    // 40% red mixed into white background -> matches CSS color-mix(in srgb, red 40%, white)
    const mixed = mixHexColors('#ff0000', '#ffffff', 40);
    expect(mixed).toEqual([255, Math.round(255 * 0.6), Math.round(255 * 0.6)]);
  });

  it('returns null when either input is unparseable', () => {
    expect(mixHexColors('nope', '#ffffff', 40)).toBeNull();
    expect(mixHexColors('#ffffff', 'nope', 40)).toBeNull();
  });
});

describe('tagFillTextVariant', () => {
  it('returns undefined when there is no tag color (nothing to override)', () => {
    expect(tagFillTextVariant(undefined, '#ffffff')).toBeUndefined();
  });

  it('returns undefined when the background is unparseable, leaving the CSS fallback', () => {
    expect(tagFillTextVariant('#ffcc00', 'not-a-color')).toBeUndefined();
  });

  it('picks dark text for a bright/light tag mixed into a light background', () => {
    // Bright yellow, 40% mixed into a light-theme background, stays very light overall.
    expect(tagFillTextVariant('#ffee58', '#ffffff')).toBe('dark');
  });

  it('picks light text for a bright/light tag mixed into a dark background', () => {
    // 40% bright yellow into a near-black dark-theme background is dominated by the 60%
    // dark background (resulting luminance ~0.16, below the ~0.179 WCAG contrast-parity
    // point) so white text still reads better than black there, even though the tag
    // itself is a light color.
    expect(tagFillTextVariant('#ffee58', '#1e1e1e')).toBe('light');
  });

  it('picks light text for a dark/desaturated tag mixed into a dark background', () => {
    expect(tagFillTextVariant('#1a1a40', '#1e1e1e')).toBe('light');
  });

  it('picks dark text for a dark/desaturated tag mixed into a light background', () => {
    // Navy mixed 40% into white is dominated by the 60% light background (resulting
    // luminance ~0.33, above the WCAG contrast-parity point) so black text wins there.
    expect(tagFillTextVariant('#00004d', '#ffffff')).toBe('dark');
  });

  it('picks a sensible variant for a mid-saturation "normal" color (blue) in both themes', () => {
    expect(tagFillTextVariant('#2196f3', '#ffffff')).toBe('dark');
    expect(tagFillTextVariant('#2196f3', '#1e1e1e')).toBe('light');
  });
});
