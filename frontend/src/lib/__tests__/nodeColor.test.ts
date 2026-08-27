import { describe, expect, it } from 'vitest';

import { normalizeNodeColor, toNodeSurfaceColor } from '../nodeColor';

describe('normalizeNodeColor', () => {
  it('accepts #rrggbb strings and lower-cases them', () => {
    expect(normalizeNodeColor('#2563EB')).toBe('#2563eb');
    expect(normalizeNodeColor('#abcdef')).toBe('#abcdef');
  });

  it('rejects null, undefined and non-string values', () => {
    expect(normalizeNodeColor(null)).toBeNull();
    expect(normalizeNodeColor(undefined)).toBeNull();
    expect(normalizeNodeColor(123)).toBeNull();
  });

  it('rejects non-hex or malformed colour strings', () => {
    expect(normalizeNodeColor('blue')).toBeNull();
    expect(normalizeNodeColor('#abc')).toBeNull();
    expect(normalizeNodeColor('#12345g')).toBeNull();
    expect(normalizeNodeColor('2563eb')).toBeNull();
  });
});

describe('toNodeSurfaceColor', () => {
  it('mixes a normalized identity colour into the active theme surface', () => {
    expect(toNodeSurfaceColor('#2563eb')).toBe(
      'color-mix(in srgb, #2563eb 24%, var(--vscode-surface-background))',
    );
  });
});
