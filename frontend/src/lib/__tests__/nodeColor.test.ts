import { describe, expect, it } from 'vitest';

import { normalizeNodeAccentColor } from '../nodeColor';

describe('normalizeNodeAccentColor', () => {
  it('accepts #rrggbb strings and lower-cases them', () => {
    expect(normalizeNodeAccentColor('#2563EB')).toBe('#2563eb');
    expect(normalizeNodeAccentColor('#abcdef')).toBe('#abcdef');
  });

  it('rejects null, undefined and non-string values', () => {
    expect(normalizeNodeAccentColor(null)).toBeNull();
    expect(normalizeNodeAccentColor(undefined)).toBeNull();
    expect(normalizeNodeAccentColor(123)).toBeNull();
  });

  it('rejects non-hex or malformed colour strings', () => {
    expect(normalizeNodeAccentColor('blue')).toBeNull();
    expect(normalizeNodeAccentColor('#abc')).toBeNull();
    expect(normalizeNodeAccentColor('#12345g')).toBeNull();
    expect(normalizeNodeAccentColor('2563eb')).toBeNull();
  });
});
