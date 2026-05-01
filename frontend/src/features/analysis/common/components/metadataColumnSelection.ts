const DEFAULT_METADATA_COLUMN = 'document';

const normalizePreferredColumns = (
  preferredColumns: string | string[] = DEFAULT_METADATA_COLUMN,
): string[] => {
  const rawColumns = Array.isArray(preferredColumns) ? preferredColumns : [preferredColumns];
  return dedupeColumns([...rawColumns, DEFAULT_METADATA_COLUMN]);
};

const dedupeColumns = (columns: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  columns.forEach((column) => {
    const trimmed = column.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

export const getDefaultMetadataColumnSelection = (
  availableColumns: string[],
  preferredColumn: string | string[] = DEFAULT_METADATA_COLUMN,
): string[] => {
  const normalizedColumns = dedupeColumns(availableColumns);
  if (normalizedColumns.length === 0) {
    return [];
  }

  const resolvedPreferredColumn = normalizePreferredColumns(preferredColumn).find((column) =>
    normalizedColumns.includes(column),
  );
  if (resolvedPreferredColumn) {
    return [resolvedPreferredColumn];
  }

  return [normalizedColumns[0]!];
};

export const reconcileMetadataColumnSelection = (
  availableColumns: string[],
  selectedColumns: string[] | null,
  preferredColumn: string | string[] = DEFAULT_METADATA_COLUMN,
): string[] => {
  const normalizedColumns = dedupeColumns(availableColumns);
  if (selectedColumns === null) {
    return getDefaultMetadataColumnSelection(normalizedColumns, preferredColumn);
  }

  const normalizedSelection = dedupeColumns(selectedColumns).filter((column) => normalizedColumns.includes(column));
  if (selectedColumns.length > 0 && normalizedSelection.length === 0) {
    return getDefaultMetadataColumnSelection(normalizedColumns, preferredColumn);
  }

  return normalizedSelection;
};

export const normalizeMetadataColumns = (columns: string[]): string[] => dedupeColumns(columns);