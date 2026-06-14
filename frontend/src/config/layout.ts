/** Sidebar pixel dimensions used by the useResizableSplit hook in the workspace shell. */
export const SIDEBAR_DEFAULT_WIDTH = 208;
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 400;

/** Right/aside panel ratio defaults for the percent-mode splitter. */
export const ASIDE_PANEL_DEFAULT_RATIO = 0.3;
export const ASIDE_PANEL_MIN_RATIO = 0.15;
export const ASIDE_PANEL_MAX_RATIO = 0.8;
export const ASIDE_PANEL_MAX_PIXELS = 800;
/** Narrower default ratio applied when the right panel collapses to the
 * compact list + schema view. The panel stays resizable; this is just the
 * width it snaps to on collapse (the previous ratio is restored on expand). */
export const ASIDE_PANEL_COLLAPSED_RATIO = 0.18;

/** Document viewer zoom bounds. */
export const DOC_ZOOM_MIN = 0.5;
export const DOC_ZOOM_MAX = 2;
export const DOC_ZOOM_STEP = 0.1;

/** Anchor highlight duration in ms (tutorial anchor scroll highlight). */
export const ANCHOR_HIGHLIGHT_DURATION_MS = 3500;
