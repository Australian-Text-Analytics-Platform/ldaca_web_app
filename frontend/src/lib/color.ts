/**
 * Colour utilities for the node-colour strategy.
 *
 * See `frontend/docs/developer-guide/node-colour-strategy.md` for the
 * design that consumes this module. Public surface:
 *
 *   - ``colorPairFor(assigned)`` — the canonical ``{ X, Y }`` pair the
 *     graph and sidebar consume. ``X`` is the assigned colour; ``Y`` is
 *     a same-hue lighter variant used for soft fills.
 *   - ``deriveLightVariant(hex)`` — exposed for direct callers; same
 *     transform ``colorPairFor`` runs internally.
 *   - ``DEFAULT_GREY_PAIR`` — the fallback pair used for any node that
 *     hasn't been promoted to an assigned colour yet.
 *
 * Conversions go via HSL so the lightness shift preserves hue identity
 * (a "light blue" stays clearly blue, not washed-out grey).
 */

/** Tailwind's gray-500 / gray-200, used as the X/Y pair for any node
 * with no assigned colour. Chosen so the visual rhythm matches the
 * existing default-grey treatment users already see. */
export const DEFAULT_GREY_PAIR: ColorPair = {
  X: '#6b7280',
  Y: '#e5e7eb',
};

export interface ColorPair {
  /** Bold variant — the assigned colour itself, used for solid fills
   * and strokes that need maximum visual weight (sidebar Active dot,
   * graph Active stroke). */
  X: string;
  /** Lighter variant — same hue with raised lightness, used for soft
   * fills (graph Active/Focus fill, sidebar Focus dot). */
  Y: string;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses user/store hex colours into RGB so palette math can stay numeric. */
/**
 * Called by: DEFAULT_GREY_PAIR and deriveLightVariant in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(HEX_RE);
  if (!match) return null;
  let raw = match[1]!;
  if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

/** Bounds fractional HSL values before converting them back to display colours. */
/** Called by: DEFAULT_GREY_PAIR and deriveLightVariant in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Bounds rounded RGB channels to browser-safe byte values. */
/** Called by: DEFAULT_GREY_PAIR and deriveLightVariant in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Formats one RGB channel for CSS hex output. */
/** Called by: DEFAULT_GREY_PAIR and deriveLightVariant in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
function toHex(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0');
}

interface Hsl {
  /** Hue, 0–360. */
  h: number;
  /** Saturation, 0–100. */
  s: number;
  /** Lightness, 0–100. */
  l: number;
}

/** Converts assigned node colours to HSL so light variants preserve hue. */
/**
 * Called by: DEFAULT_GREY_PAIR and deriveLightVariant in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
function rgbToHsl(r: number, g: number, b: number): Hsl {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case R:
        h = (G - B) / d + (G < B ? 6 : 0);
        break;
      case G:
        h = (B - R) / d + 2;
        break;
      default:
        h = (R - G) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** Converts adjusted HSL values back to RGB for CSS output. */
/**
 * Called by: DEFAULT_GREY_PAIR and deriveLightVariant in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const H = ((h % 360) + 360) % 360 / 360;
  const S = clamp01(s / 100);
  const L = clamp01(l / 100);
  if (S === 0) {
    const v = L * 255;
    return { r: v, g: v, b: v };
  }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  /** Samples one hue-offset channel from the temporary HSL conversion curve. */
  /**
   * Called by: hslToRgb in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
   * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
   */
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: channel(H + 1 / 3) * 255,
    g: channel(H) * 255,
    b: channel(H - 1 / 3) * 255,
  };
}

/** Default target lightness (in HSL %) for the Y variant. Tuned so
 * darker palette colours (Tailwind 600 range, L ≈ 45-55) become a
 * clearly recognisable but pale tint — close to a Tailwind 200 shade. */
const DEFAULT_LIGHT_VARIANT_LIGHTNESS = 86;

/**
 * Produce a same-hue lighter variant of ``hex``.
 *
 * Returns the input unchanged if it can't be parsed. Idempotent in the
 * sense that re-lightening an already-light colour clamps at the
 * target; it won't drift further.
 */
/**
 * Used by: src/lib/__tests__/color.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export function deriveLightVariant(
  hex: string,
  targetLightness: number = DEFAULT_LIGHT_VARIANT_LIGHTNESS,
): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // Keep at least a little saturation so the variant doesn't collapse
  // to a flat grey for already-muted picks.
  const saturation = Math.max(hsl.s, hsl.s === 0 ? 0 : 20);
  const lightness = Math.max(hsl.l, targetLightness);
  const out = hslToRgb(hsl.h, saturation, lightness);
  return `#${toHex(out.r)}${toHex(out.g)}${toHex(out.b)}`;
}

/**
 * Resolve the ``{ X, Y }`` pair a render surface should consume.
 *
 * - ``assigned`` truthy + parsable → ``{ X: assigned, Y: lightVariant(assigned) }``.
 * - ``assigned`` null / undefined / empty / unparsable → ``DEFAULT_GREY_PAIR``.
 */
/** Used by: src/lib/__tests__/color.test.ts, src/lib/nodeVisualState.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export function colorPairFor(assigned: string | null | undefined): ColorPair {
  if (!assigned) return DEFAULT_GREY_PAIR;
  const rgb = parseHex(assigned);
  if (!rgb) return DEFAULT_GREY_PAIR;
  return { X: assigned, Y: deriveLightVariant(assigned) };
}
