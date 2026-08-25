/** Matches the ``#rrggbb`` colours persisted on ``Node.color`` by the backend
 * node update resource. */
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Normalises a raw ``Node.color`` value into a render-safe identity colour.
 * Used by: the workspace graph node card (CustomNode) and the Data Blocks list
 * row (WorkspaceNodeList) because both fill an identity surface from the node's
 * persisted colour and must ignore ``null`` / non-hex values so uncoloured
 * nodes keep their default look.
 * Returns the lower-cased ``#rrggbb`` string when valid, otherwise ``null``.
 */
export function normalizeNodeAccentColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : null;
}
