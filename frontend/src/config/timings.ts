/**
 * UI timing constants. Kept together so a single edit covers every
 * "feels slow" knob (and so the values aren't scattered across feature
 * files where they'd drift independently).
 */

/**
 * How long the bootstrap screen waits before showing the "this is taking
 * longer than usual" hint. Anything below ~5s false-fires for users on
 * cold-start; anything above ~10s feels like the app is frozen.
 */
export const LAG_HINT_DELAY_MS = 8000;

/**
 * Refresh-banner gating: the chip-style "refreshing…" indicator only
 * surfaces if the refresh actually takes longer than this. Avoids a
 * flash for the common-case fast refresh.
 */
export const REFRESH_CHIP_DELAY_MS = 3000;
