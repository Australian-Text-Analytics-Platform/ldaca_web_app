import type { NodeLike } from '@/hooks/useNodeColumnInfos';

/** Finds the backend-declared document column so text-analysis tools prefer the intended text field. */
export const extractDocumentColumn = (node: NodeLike): string => {
  const candidates = [
    (node?.data as { documentColumn?: string } | undefined)?.documentColumn,
    (node?.data as { document_column?: string } | undefined)?.document_column,
    (node?.data as { document?: string } | undefined)?.document,
    (node as { documentColumn?: string } | undefined)?.documentColumn,
    (node as { document_column?: string } | undefined)?.document_column,
    (node as { document?: string } | undefined)?.document,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length) {
      return candidate;
    }
  }
  return '';
};
