/**
 * Static colour palette for data-block (workspace node) colouring and in-result
 * data visualisations (e.g. the concordance dispersion plot's matched-term
 * colours and the combined results table's per-source colours).
 *
 * Two roles per colour:
 * - FG (`VIZ_PALETTE`): the saturated identity colour. Used for the node card's
 *   left accent spine, the sidebar row spine, word-cloud text, chart series,
 *   and as the value persisted on ``Node.color``.
 * - BG (`toBgColor` / `VIZ_PALETTE_BG`): a light tint of the same hue for
 *   filling backgrounds behind black text (frequency list rows, node card
 *   fills, sidebar row fills). Every BG tint keeps black-text contrast well
 *   above WCAG AAA (>=15:1), so dark text is always legible on it.
 *
 * ``GREY`` is the default colour for new / un-analysed data blocks and is
 * excluded from random allocation (`RANDOMIZABLE_FG`); a user may still pick it
 * manually, in which case it persists like any other choice.
 *
 * Used by: useNodeColorControls (allocation), CustomNode + WorkspaceNodeList
 * (fills/spines), token-frequency result views, and analysis chart legends.
 */
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
  '#6b7280',
];

/** Neutral grey — the default for new/un-analysed blocks; excluded from random allocation. */
export const GREY = '#6b7280';

/** FG colours eligible for random allocation to a freshly-analysed block (grey excluded). */
export const RANDOMIZABLE_FG: string[] = VIZ_PALETTE.filter((color) => color !== GREY);

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Fraction of the source colour blended over white to make its background tint. */
const BG_COLOR_MIX = 0.18;

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/**
 * Derives a light background tint from any ``#rrggbb`` colour by mixing
 * ``BG_COLOR_MIX`` of the colour over white. Keeps the hue identity while
 * guaranteeing high contrast for black text (validated >=15:1 for every FG
 * palette colour). Works for custom user-picked colours too, not just the
 * palette. Returns the input unchanged when it is not a valid hex colour.
 * Used by: node card fills, sidebar row fills, and the frequency list row bars.
 */
export function toBgColor(fg: string, mix: number = BG_COLOR_MIX): string {
  if (!HEX_COLOR_RE.test(fg)) return fg;
  const hex = fg.slice(1);
  const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const tinted = channels.map((c) => clampChannel(c * mix + 255 * (1 - mix)));
  return `#${tinted.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Precomputed background tints for the FG palette, index-aligned with `VIZ_PALETTE`. */
export const VIZ_PALETTE_BG: string[] = VIZ_PALETTE.map((color) => toBgColor(color));

/**
 * Picks a colour to assign to a not-yet-coloured block, at random from
 * `RANDOMIZABLE_FG` (grey excluded), avoiding any colour in ``used`` so blocks
 * selected together in one analysis tool get distinct colours. Falls back to a
 * random non-grey colour (allowing a repeat) once every palette colour is taken.
 * Used by: useNodeColorControls.ensureNodeColors when an analysis run assigns
 * durable colours to its still-uncoloured source blocks.
 */
export function pickRandomColor(used: Iterable<string> = []): string {
  const taken = new Set(Array.from(used, (c) => c.toLowerCase()));
  const available = RANDOMIZABLE_FG.filter((color) => !taken.has(color.toLowerCase()));
  const pool = available.length > 0 ? available : RANDOMIZABLE_FG;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] ?? pool[0] ?? VIZ_PALETTE[0] ?? GREY;
}
