import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

type NodeWithDerived = {
  id?: unknown;
  node_id?: unknown;
  derived?: unknown;
  [key: string]: unknown;
};

type Selection = {
  nodeId: string;
  column?: string;
};

export type TokensColumnMismatchNoticeProps = {
  nodes: ReadonlyArray<NodeWithDerived>;
  selections: ReadonlyArray<Selection>;
  className?: string;
};

const nodeMatchesId = (node: NodeWithDerived, id: string) =>
  [node.id, node.node_id].some((value) => typeof value === 'string' && value === id);

const collectTokensSources = (derived: unknown): string[] => {
  if (!derived || typeof derived !== 'object') return [];
  const sources = new Set<string>();
  for (const meta of Object.values(derived as Record<string, unknown>)) {
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as { source_column?: unknown; form?: unknown };
    if (m.form !== 'tokens') continue;
    if (typeof m.source_column === 'string' && m.source_column) {
      sources.add(m.source_column);
    }
  }
  return Array.from(sources);
};

/**
 * Inline notice that surfaces when the user has selected a text column for
 * analysis that *doesn't* have a derived tokens column, but the node does
 * carry tokens derived for some *other* column. Without this, running the
 * analysis silently falls back to live-tokenisation on every run — fast on
 * Latin-script corpora, painfully slow on CJK ones. The notice nudges the
 * user to tokenise the selected column before running.
 *
 * Only inspects the first selection — analyses cap their input at one or two
 * nodes and the first is enough to detect the mismatch pattern (typically a
 * user clicked Tokenise on the wrong column).
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
    const tokensSources = collectTokensSources(node.derived);
    if (tokensSources.length === 0) return null;
    if (tokensSources.includes(first.column)) return null;
    return { selectedColumn: first.column, tokensSources };
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
      <strong className="font-semibold">No tokens for <code>{mismatch.selectedColumn}</code>.</strong>{' '}
      Tokens are derived for: {mismatch.tokensSources.map((src, i) => (
        <React.Fragment key={src}>
          {i > 0 ? ', ' : ''}
          <code>{src}</code>
        </React.Fragment>
      ))}
      . Running on <code>{mismatch.selectedColumn}</code> will tokenise live each
      time — slow for CJK corpora. Tokenise <code>{mismatch.selectedColumn}</code>{' '}
      from the column header first for a faster, cached path.
    </div>
  );
};

export default TokensColumnMismatchNotice;
