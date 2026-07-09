/** Matches the ``#rrggbb`` colours persisted on ``Node.color`` by the backend
 * ``POST /api/workspaces/{workspace_id}/nodes/{node_id}/color`` endpoint. */
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Normalises a raw ``Node.color`` value into a render-safe accent colour.
 * Used by: the workspace graph node card (CustomNode) and the Data Blocks list
 * row (WorkspaceNodeList) because both paint a left accent from the node's
 * persisted colour and must ignore ``null`` / legacy non-hex values so
 * uncoloured nodes keep their default look.
 * Returns the lower-cased ``#rrggbb`` string when valid, otherwise ``null``.
 */
export function normalizeNodeAccentColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : null;
}
