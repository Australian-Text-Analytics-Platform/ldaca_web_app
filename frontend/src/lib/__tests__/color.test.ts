import { describe, expect, it } from 'vitest';
import {
  colorPairFor,
  DEFAULT_GREY_PAIR,
  deriveLightVariant,
} from '../color';

/** Tailwind / hex inspection helpers — converted inline so the tests
 * stay decoupled from the colour module's internal HSL plumbing. */
/** Used by: tests in this file because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const s = hex.replace('#', '');
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/** Computes HSL lightness inline so tests validate public output, not private color helpers. */
/** Used by: tests in this file because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
function rgbLightness(r: number, g: number, b: number): number {
  // HSL L = (max + min) / 2, expressed as 0–100.
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return ((max + min) / 2 / 255) * 100;
}

describe('deriveLightVariant', () => {
  it('produces a strictly lighter shade than the input for ordinary palette colours', () => {
    // EXTENDED_PALETTE entries are Tailwind-600 family (L ≈ 45-55).
    for (const hex of ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#d97706']) {
      const { r: r0, g: g0, b: b0 } = hexToRgb(hex);
      const { r: r1, g: g1, b: b1 } = hexToRgb(deriveLightVariant(hex));
      expect(rgbLightness(r1, g1, b1)).toBeGreaterThan(rgbLightness(r0, g0, b0));
    }
  });

  it('lands the variant near the target lightness (~86 by default)', () => {
    const variant = deriveLightVariant('#2563eb');
    const { r, g, b } = hexToRgb(variant);
    // Allow a small rounding window.
    expect(rgbLightness(r, g, b)).toBeGreaterThanOrEqual(83);
    expect(rgbLightness(r, g, b)).toBeLessThanOrEqual(92);
  });

  it('preserves the input hue family (blue stays bluer than red/green)', () => {
    // Quick discriminator: for a "light blue" we expect B > R and B > G.
    const { r, g, b } = hexToRgb(deriveLightVariant('#2563eb'));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('is approximately idempotent — relightening an already-light shade does not drift further', () => {
    const once = deriveLightVariant('#2563eb');
    const twice = deriveLightVariant(once);
    const { r: r1, g: g1, b: b1 } = hexToRgb(once);
    const { r: r2, g: g2, b: b2 } = hexToRgb(twice);
    expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(2);
    expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(2);
    expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(2);
  });

  it('accepts 3-char hex shorthand', () => {
    const variant = deriveLightVariant('#06f');
    expect(variant).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('accepts hex without leading #', () => {
    const variant = deriveLightVariant('2563eb');
    expect(variant).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('returns the input unchanged when the hex is unparsable', () => {
    expect(deriveLightVariant('not-a-colour')).toBe('not-a-colour');
    expect(deriveLightVariant('')).toBe('');
    expect(deriveLightVariant('#zz12345')).toBe('#zz12345');
  });

  it('honours a caller-supplied target lightness', () => {
    const lighter = deriveLightVariant('#2563eb', 95);
    const darker = deriveLightVariant('#2563eb', 86);
    const { r: rL, g: gL, b: bL } = hexToRgb(lighter);
    const { r: rD, g: gD, b: bD } = hexToRgb(darker);
    expect(rgbLightness(rL, gL, bL)).toBeGreaterThan(rgbLightness(rD, gD, bD));
  });
});

describe('colorPairFor', () => {
  it('returns the grey fallback pair for null / undefined / empty', () => {
    expect(colorPairFor(null)).toEqual(DEFAULT_GREY_PAIR);
    expect(colorPairFor(undefined)).toEqual(DEFAULT_GREY_PAIR);
    expect(colorPairFor('')).toEqual(DEFAULT_GREY_PAIR);
  });

  it('returns the grey fallback pair for unparsable hex', () => {
    expect(colorPairFor('not-a-colour')).toEqual(DEFAULT_GREY_PAIR);
    expect(colorPairFor('#1234')).toEqual(DEFAULT_GREY_PAIR);
  });

  it('returns the assigned colour as X and a lighter variant as Y', () => {
    const pair = colorPairFor('#2563eb');
    expect(pair.X).toBe('#2563eb');
    expect(pair.Y).not.toBe('#2563eb');
    const { r: rX, g: gX, b: bX } = hexToRgb(pair.X);
    const { r: rY, g: gY, b: bY } = hexToRgb(pair.Y);
    expect(rgbLightness(rY, gY, bY)).toBeGreaterThan(rgbLightness(rX, gX, bX));
  });

  it('keeps the same hue across X and Y (blue assigned → blue tint)', () => {
    const pair = colorPairFor('#2563eb');
    const { r, g, b } = hexToRgb(pair.Y);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('grey default pair has X meaningfully darker than Y', () => {
    const { r: rX, g: gX, b: bX } = hexToRgb(DEFAULT_GREY_PAIR.X);
    const { r: rY, g: gY, b: bY } = hexToRgb(DEFAULT_GREY_PAIR.Y);
    expect(rgbLightness(rX, gX, bX)).toBeLessThan(rgbLightness(rY, gY, bY));
  });
});
