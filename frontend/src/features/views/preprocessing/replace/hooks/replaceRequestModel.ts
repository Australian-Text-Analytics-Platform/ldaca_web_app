export type ReplaceMode = 'replace' | 'extract';

export interface ReplaceRequest {
  source_column: string;
  pattern: string;
  replacement?: string;
  output_column?: string;
  mode?: ReplaceMode;
  count?: 'all' | 'first';
  match_limit?: number;
  connector?: string;
  name?: string;
}

export interface ReplaceRequestDraft {
  selectedColumn: string;
  pattern: string;
  replacement: string;
  outputColumnName: string;
  mode: ReplaceMode;
  n: number | null;
  connector: string;
}

/**
 * Resolves the output column for Find preview and apply requests. Leaving the
 * field empty means the selected source column is overwritten.
 * Used by: useReplaceSubTab because both preview and apply need identical
 * defaulting before sending `ReplaceRequest` payloads to the backend.
 */
export const resolveReplaceOutputColumnName = ({
  selectedColumn,
  outputColumnName,
}: Pick<ReplaceRequestDraft, 'selectedColumn' | 'outputColumnName'>): string =>
  outputColumnName.trim() || selectedColumn;

/**
 * Converts the Find form draft into the backend request shape.
 * Used by: useReplaceSubTab preview and apply paths so mode/count/connector
 * rules stay in one tested model instead of being duplicated in event code.
 * Flow: reject incomplete source/pattern inputs, default the output column,
 * translate blank match count to "all", and include extract-only connector
 * settings when present.
 */
export const buildReplaceRequest = (draft: ReplaceRequestDraft): ReplaceRequest | null => {
  if (!draft.selectedColumn || draft.pattern.length === 0) return null;

  const count = draft.n !== null ? 'first' : 'all';
  const connector = draft.connector === '' ? undefined : draft.connector;

  return {
    source_column: draft.selectedColumn,
    pattern: draft.pattern,
    replacement: draft.replacement,
    output_column: resolveReplaceOutputColumnName(draft),
    mode: draft.mode,
    count,
    match_limit: count === 'first' ? (draft.n ?? 1) : undefined,
    connector: draft.mode === 'extract' ? connector : undefined,
  };
};
