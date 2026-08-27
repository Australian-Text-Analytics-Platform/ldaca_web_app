/** Matches the ``#rrggbb`` colours persisted on ``Node.color`` by the backend
 * node update resource. */
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Normalises a raw ``Node.color`` value into a render-safe identity colour.
 * Used by: the workspace graph node card (CustomNode) and the Data Blocks list
 * row (WorkspaceNodeList) because both derive an identity surface from the
 * node's persisted colour and must ignore ``null`` / non-hex values so uncoloured
 * nodes keep their default look.
 * Returns the lower-cased ``#rrggbb`` string when valid, otherwise ``null``.
 */
export function normalizeNodeColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : null;
}

/** Fraction of the Data Block identity colour mixed into the active surface. */
const NODE_SURFACE_MIX_PERCENT = 24;

/**
 * Derives the quiet, theme-aware fill used by large Data Block identity
 * surfaces. The saturated ``Node.color`` remains unchanged for compact marks
 * such as chart series and legends; graph cards and list rows blend it into
 * the active VS Code surface so the same identity is less visually dominant.
 */
export function toNodeSurfaceColor(color: string): string {
  return `color-mix(in srgb, ${color} ${String(NODE_SURFACE_MIX_PERCENT)}%, var(--vscode-surface-background))`;
}
