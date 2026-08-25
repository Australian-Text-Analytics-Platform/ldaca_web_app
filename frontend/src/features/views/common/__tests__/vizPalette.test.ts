import { describe, expect, it, vi } from 'vitest';

import {
  GREY,
  RANDOMIZABLE_FG,
  VIZ_PALETTE,
  VIZ_PALETTE_BG,
  VIZ_TINT_FOREGROUND,
  foregroundForVizColor,
  pickRandomColor,
  toBgColor,
} from '../vizPalette';

/** WCAG relative luminance of an #rrggbb colour. */
function luminance(hex: string): number {
  const linear = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

const contrast = (foreground: string, background: string): number => {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

describe('toBgColor', () => {
  it('produces a light tint with strong black-text contrast for every FG colour', () => {
    for (const fg of VIZ_PALETTE) {
      const bg = toBgColor(fg);
      expect(bg).toMatch(/^#[0-9a-f]{6}$/);
      // Comfortably above WCAG AAA (7:1) with the fixed tint foreground in either UI theme.
      expect(contrast(VIZ_TINT_FOREGROUND, bg)).toBeGreaterThan(7);
    }
  });

  it('is index-aligned with the precomputed VIZ_PALETTE_BG', () => {
    expect(VIZ_PALETTE_BG).toEqual(VIZ_PALETTE.map((c) => toBgColor(c)));
  });

  it('returns invalid input unchanged', () => {
    expect(toBgColor('not-a-color')).toBe('not-a-color');
  });
});

describe('foregroundForVizColor', () => {
  it('chooses a WCAG-readable foreground for every saturated identity colour', () => {
    for (const background of VIZ_PALETTE) {
      const foreground = foregroundForVizColor(background);
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to the dark foreground for invalid input', () => {
    expect(foregroundForVizColor('not-a-color')).toBe(VIZ_TINT_FOREGROUND);
  });
});

describe('pickRandomColor', () => {
  it('never returns grey', () => {
    expect(RANDOMIZABLE_FG).not.toContain(GREY);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(pickRandomColor()).not.toBe(GREY);
    vi.restoreAllMocks();
  });

  it('avoids colours already in use', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const used = RANDOMIZABLE_FG.slice(0, 1);
    const picked = pickRandomColor(used);
    expect(picked).not.toBe(RANDOMIZABLE_FG[0]);
    expect(RANDOMIZABLE_FG).toContain(picked);
    vi.restoreAllMocks();
  });

  it('falls back to a valid colour when every palette colour is used', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const picked = pickRandomColor(RANDOMIZABLE_FG);
    expect(RANDOMIZABLE_FG).toContain(picked);
    vi.restoreAllMocks();
  });
});
