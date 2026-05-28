interface NodeWithDocumentColumn {
  documentColumn?: string;
  document_column?: string;
  document?: string;
  data?: {
    documentColumn?: string;
    document_column?: string;
    document?: string;
    node?: {
      documentColumn?: string;
      document_column?: string;
      document?: string;
    };
  };
}

/**
 * Safely narrows loose node metadata before reading nested document fields.
 * Used by: local callers in workspace/documentColumn module.
 * Why: because analysis and table helpers need one metadata lookup for the document column instead of duplicating node-shape checks.
 */
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

/**
 * Finds the column RowDetailPanel should treat as the document text.
 * Used by: AggregateSubTab module, nodeMetadata utilities, FilterSubTab module (rg call sites/imports).
 * Why: because analysis and table helpers need one metadata lookup for the document column instead of duplicating node-shape checks.
 * Flow: inspect top-level aliases first, then nested data/node metadata aliases, returning the first string candidate.
 */
export const getNodeDocumentColumn = (node: unknown): string | undefined => {
  const nodeRecord = isRecord(node) ? (node as NodeWithDocumentColumn) : undefined;
  const candidates = [
    nodeRecord?.documentColumn,
    nodeRecord?.document_column,
    nodeRecord?.document,
    nodeRecord?.data?.documentColumn,
    nodeRecord?.data?.document_column,
    nodeRecord?.data?.document,
    nodeRecord?.data?.node?.documentColumn,
    nodeRecord?.data?.node?.document_column,
    nodeRecord?.data?.node?.document,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
};
