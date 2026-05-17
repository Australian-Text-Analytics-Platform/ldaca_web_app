/**
 * Canonical palette for analysis features.
 * 6-color base palette used by stack allocator and fallback assignments.
 */
export const DEFAULT_PALETTE: string[] = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#0d9488', '#db2777',
];

/**
 * Slate-500. Doubles as the "no colour assigned" indicator across the
 * UI: nodes without a user-picked or auto-assigned colour render in
 * this shade so the user can tell at a glance that the node hasn't
 * been coloured yet. Lives in EXTENDED_PALETTE so the colour picker
 * can still offer it as an explicit choice, but excluded from
 * AUTO_ASSIGN_PALETTE so a random / positional auto-roll never lands
 * on it — picking it automatically would re-create the "uncoloured"
 * look on a node that actually has a colour.
 */
export const UNASSIGNED_NODE_COLOR = '#6b7280';

/**
 * Extended 12-color palette for features that need more colors (e.g. concordance).
 * Used as the picker swatch source — every entry here is offered to
 * the user, including UNASSIGNED_NODE_COLOR as a deliberate choice.
 */
export const EXTENDED_PALETTE: string[] = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#d97706', '#0d9488',
  '#db2777', '#4f46e5', '#65a30d', '#0891b2', '#92400e', UNASSIGNED_NODE_COLOR,
];

/**
 * Subset of EXTENDED_PALETTE that automatic / random assignment may
 * pick from. Excludes UNASSIGNED_NODE_COLOR for the reason above.
 * The deterministic positional roller (ensureColors) and the
 * conflict-avoiding random roller (pickRandomPaletteAvoiding) both
 * iterate this list, not the full palette.
 */
export const AUTO_ASSIGN_PALETTE: string[] = EXTENDED_PALETTE.filter(
  (c) => c !== UNASSIGNED_NODE_COLOR,
);
