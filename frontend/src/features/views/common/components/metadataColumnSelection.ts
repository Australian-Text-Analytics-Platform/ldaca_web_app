/**
 * De-duplicate and trim metadata column names. Used by: MetadataColumnSelector because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * to keep its `availableColumns` / `selectedColumns` lists canonical.
 */
export const normalizeMetadataColumns = (columns: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  columns.forEach((column) => {
    const trimmed = column.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};
