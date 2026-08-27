/**
 * Static colour palette for data-block (workspace node) colouring and in-result
 * data visualisations (e.g. the concordance dispersion plot's matched-term
 * colours and the combined results table's per-source colours).
 *
 * Two roles per colour:
 * - FG (`VIZ_PALETTE`): the saturated identity colour. Used for compact marks,
 *   word-cloud text, chart series, and as the value persisted on ``Node.color``.
 *   Graph and list Data Block surfaces derive a quieter theme-aware fill from
 *   the same identity colour.
 * - BG (`toBgColor`): a light tint of the same hue for
 *   filling backgrounds behind black text (for example frequency list rows).
 *   Every BG tint keeps black-text contrast well
 *   above WCAG AAA (>=15:1), so dark text is always legible on it.
 *
 * ``GREY`` is the default colour for new / un-analysed data blocks and is
 * excluded from random allocation (`RANDOMIZABLE_FG`); a user may still pick it
 * manually, in which case it persists like any other choice.
 *
 * Used by: useNodeColorControls (allocation), CustomNode + WorkspaceNodeList
 * (identity source colours), token-frequency result views, and analysis chart legends.
 */
/** Neutral grey — the default for new/un-analysed blocks; excluded from random allocation. */
export const GREY = '#6b7280';

export const VIZ_PALETTE: string[] = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#d97706',
  '#0d9488',
  '#db2777',
  '#4f46e5',
  '#65a30d',
  '#0891b2',
  '#92400e',
  GREY,
];

/** Foreground paired with the theme-independent light tints returned by `toBgColor`. */
const VIZ_TINT_FOREGROUND = '#111827';

/** Light foreground candidate for saturated Data Block identity surfaces. */
const VIZ_LIGHT_FOREGROUND = '#ffffff';

/** FG colours eligible for random allocation to a freshly-analysed block (grey excluded). */
export const RANDOMIZABLE_FG: string[] = VIZ_PALETTE.filter((color) => color !== GREY);

/** WCAG relative luminance of an ``#rrggbb`` colour. */
function relativeLuminance(hex: string): number {
  const linearChannel = (offset: number): number => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearChannel(1) + 0.7152 * linearChannel(3) + 0.0722 * linearChannel(5);
}

/** Contrast ratio between two valid ``#rrggbb`` colours. */
function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Chooses the higher-contrast foreground for a saturated Data Block colour.
 * Callers provide a normalized ``#rrggbb`` colour.
 */
export function foregroundForVizColor(background: string): string {
  return contrastRatio(VIZ_LIGHT_FOREGROUND, background) >
    contrastRatio(VIZ_TINT_FOREGROUND, background)
    ? VIZ_LIGHT_FOREGROUND
    : VIZ_TINT_FOREGROUND;
}

/** Fraction of the source colour blended over white to make its background tint. */
const BG_COLOR_MIX = 0.18;

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/**
 * Derives a light background tint from any ``#rrggbb`` colour by mixing
 * ``BG_COLOR_MIX`` of the colour over white. Keeps the hue identity while
 * guaranteeing high contrast for black text (validated >=15:1 for every FG
 * palette colour). Works for custom user-picked colours too, not just the
 * palette. Callers provide a normalized ``#rrggbb`` colour.
 * Used by: frequency list row bars and other light-tint visualisation surfaces.
 */
export function toBgColor(fg: string, mix: number = BG_COLOR_MIX): string {
  const hex = fg.slice(1);
  const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const tinted = channels.map((c) => clampChannel(c * mix + 255 * (1 - mix)));
  return `#${tinted.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Picks a colour to assign to a not-yet-coloured block, at random from
 * `RANDOMIZABLE_FG` (grey excluded), avoiding any colour in ``used`` so blocks
 * selected together in one analysis tool get distinct colours. Reuses a random
 * non-grey colour once every palette colour is taken.
 * Used by: useNodeColorControls.ensureNodeColors when an analysis run assigns
 * durable colours to its still-uncoloured source blocks.
 */
export function pickRandomColor(used: Iterable<string> = []): string {
  const taken = new Set(Array.from(used, (c) => c.toLowerCase()));
  const available = RANDOMIZABLE_FG.filter((color) => !taken.has(color.toLowerCase()));
  const pool = available.length > 0 ? available : RANDOMIZABLE_FG;
  const index = Math.floor(Math.random() * pool.length);
  const color = pool[index];
  if (color === undefined) throw new Error('Randomizable visualization palette is empty');
  return color;
}
