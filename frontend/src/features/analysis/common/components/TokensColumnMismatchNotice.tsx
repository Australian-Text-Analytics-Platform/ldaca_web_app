import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

type NodeWithTokenizerModels = {
  id?: unknown;
  node_id?: unknown;
  tokenizer_models?: unknown;
  [key: string]: unknown;
};

type Selection = {
  nodeId: string;
  column?: string;
};

export type TokensColumnMismatchNoticeProps = {
  nodes: ReadonlyArray<NodeWithTokenizerModels>;
  selections: ReadonlyArray<Selection>;
  className?: string;
};

/** Called by: TokensColumnMismatchNotice when matching selections to workspace nodes because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const nodeMatchesId = (node: NodeWithTokenizerModels, id: string) =>
  [node.id, node.node_id].some((value) => typeof value === 'string' && value === id);

/** Called by: TokensColumnMismatchNotice to describe saved tokenizer-model columns because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const collectTokenizerModelSources = (tokenizerModels: unknown): string[] => {
  if (!tokenizerModels || typeof tokenizerModels !== 'object') return [];
  return Object.keys(tokenizerModels).filter(Boolean);
};

/**
 * Inline notice that surfaces when the user has selected a text column for
 * analysis that doesn't have a persisted tokenizer model, but the node does
 * have a tokenizer model saved for another column.
 *
 * Only inspects the first selection — analyses cap their input at one or two
 * nodes and the first is enough to detect the mismatch pattern (typically a
 * user previously cached tokens for a different column).
 * Used by: token-frequency and concordance parameter panels because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export const TokensColumnMismatchNotice: React.FC<TokensColumnMismatchNoticeProps> = ({
  nodes,
  selections,
  className,
}) => {
  const mismatch = useMemo(() => {
    const first = selections[0];
    if (!first?.column || !first.nodeId) return null;
    const node = nodes.find((n) => nodeMatchesId(n, first.nodeId));
    if (!node) return null;
    const tokenizerModelSources = collectTokenizerModelSources(node.tokenizer_models);
    if (tokenizerModelSources.length === 0) return null;
    if (tokenizerModelSources.includes(first.column)) return null;
    return { selectedColumn: first.column, tokenizerModelSources };
  }, [nodes, selections]);

  if (!mismatch) return null;

  return (
    <div
      className={cn(
        'rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200',
        className,
      )}
      role="note"
    >
      <strong className="font-semibold">No tokenizer model for <code>{mismatch.selectedColumn}</code>.</strong>{' '}
      Tokenizer models are saved for: {mismatch.tokenizerModelSources.map((src, i) => (
        <React.Fragment key={src}>
          {i > 0 ? ', ' : ''}
          <code>{src}</code>
        </React.Fragment>
      ))}
      . Select one of those columns to reuse its saved model, or choose a tokenizer model for{' '}
      <code>{mismatch.selectedColumn}</code>.
    </div>
  );
};

export default TokensColumnMismatchNotice;
