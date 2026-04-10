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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

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