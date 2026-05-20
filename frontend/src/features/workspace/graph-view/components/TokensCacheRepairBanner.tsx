import React from 'react';
import { AlertTriangle } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';

/**
 * Banner shown when a workspace was loaded from a different machine (or OS)
 * and the donor's tokens-cache parquet files weren't available on the
 * receiver. The backend's repair pass writes empty stub parquets in their
 * place so the workspace doesn't crash on load, but tokenised analyses
 * (concordance tokens-mode, token-frequency, topic modelling) return
 * empty results until the user re-tokenises each affected node.
 *
 * The repair-state list lives on the workspace graph response
 * (`tokens_cache_repair.stubbed_node_ids`) and is cleared automatically as
 * the user re-tokenises each listed node. See backend docs:
 * developer-guide/tokens-cache-portability.md.
 */
export const TokensCacheRepairBanner: React.FC = () => {
  const { workspaceGraph } = useWorkspaceData();
  const stubbedIds = workspaceGraph?.tokens_cache_repair?.stubbed_node_ids;

  if (!stubbedIds || stubbedIds.length === 0) {
    return null;
  }

  // Resolve node ids → display names. Falls back to the id itself if a node
  // listed in the sidecar has since been removed from the workspace (so the
  // banner doesn't render an empty bullet).
  const nodes = workspaceGraph?.nodes ?? [];
  const nodeNameById = new Map(nodes.map((n) => [n.id, n.name ?? n.id]));
  const labels = stubbedIds.map((id) => nodeNameById.get(id) ?? id);

  return (
    <Card className="border-amber-500/60 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/40 mb-4">
      <CardContent className="flex items-start gap-3 py-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 min-w-0 text-sm">
          <div className="font-medium">
            Tokens cache missing on this machine
          </div>
          <div className="mt-1 text-muted-foreground">
            This workspace was loaded from another machine, but its tokens
            cache files didn't travel with the bundle. Tokenised analyses
            (concordance tokens-mode, token frequency, topic modelling) will
            return empty results until you re-tokenise the affected block
            {labels.length === 1 ? '' : 's'}:
          </div>
          <ul className="mt-1.5 ml-4 list-disc text-muted-foreground">
            {labels.map((label, idx) => (
              <li key={`${stubbedIds[idx]}-${idx}`} className="truncate">
                {label}
              </li>
            ))}
          </ul>
          <div className="mt-2 text-muted-foreground">
            Right-click each block in the graph and pick{' '}
            <span className="font-medium">Tokenise</span> to restore.
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TokensCacheRepairBanner;
