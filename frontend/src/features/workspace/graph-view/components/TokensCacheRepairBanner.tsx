import React, { useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { nodesApi } from '@/api/nodes';
import { queryKeys } from '@/lib/queryKeys';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';

// Session-scoped dismiss key — keyed by a stable hash of the sorted
// stubbed_node_ids so a dismissal sticks for THIS set of broken blocks
// but re-fires if the set later changes (e.g. a re-tokenise that only
// fixed some of them, or a fresh workspace load that surfaces new ones).
const DISMISS_KEY = 'ldaca.tokens-cache-banner.dismissedFor';

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
 * the user re-tokenises each listed node — either via the per-block
 * Tokenise dialog or via the "Re-tokenise all" shortcut below. See backend
 * docs: developer-guide/tokens-cache-portability.md.
 */
export const TokensCacheRepairBanner: React.FC = () => {
  const { workspaceGraph, currentWorkspaceId } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });

  const stubbedIds = workspaceGraph?.tokens_cache_repair?.stubbed_node_ids;
  const nodes = workspaceGraph?.nodes ?? [];

  if (!stubbedIds || stubbedIds.length === 0) {
    return null;
  }

  // Stable key for the current set of stubbed blocks. If the user has
  // already dismissed *this exact set*, stay hidden until the set
  // changes (new block becomes stubbed, or one gets fixed).
  const currentKey = [...stubbedIds].sort().join('|');
  if (dismissedFor === currentKey) {
    return null;
  }

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, currentKey);
    } catch {
      /* sessionStorage can throw in private-mode Safari etc. — fine to ignore */
    }
    setDismissedFor(currentKey);
  };

  // Resolve node ids → display names. Falls back to the id itself if a node
  // listed in the sidecar has since been removed from the workspace (so the
  // banner doesn't render an empty bullet).
  const nodeNameById = new Map(nodes.map((n) => [n.id, n.name ?? n.id]));
  const labels = stubbedIds.map((id) => nodeNameById.get(id) ?? id);

  const handleRetokeniseAll = async () => {
    if (submitting || !stubbedIds.length) return;
    setSubmitting(true);
    try {
      const result = await nodesApi.bulkRetokenise(
        stubbedIds,
        getAuthHeaders(),
      );
      const succeeded = result.succeeded.length;
      const failed = result.failed.length;
      const skipped = result.skipped.length;
      if (succeeded > 0) {
        toast.success(
          `Re-tokenised ${succeeded} block${succeeded === 1 ? '' : 's'}` +
            (failed ? ` · ${failed} failed` : '') +
            (skipped ? ` · ${skipped} skipped` : ''),
        );
      } else if (failed > 0) {
        const firstError = result.failed[0]?.error ?? 'unknown error';
        toast.error(`Re-tokenise failed: ${firstError}`);
      } else {
        toast.info('No blocks were re-tokenised.');
      }
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.workspaceGraph(currentWorkspaceId),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Re-tokenise failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-amber-500/60 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/40 mb-2 max-w-2xl">
      <CardContent className="flex items-start gap-3 py-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 min-w-0 text-sm">
          {/* Floats inside the flex row so the close button sits at the
              far right of the banner header without affecting the body
              wrapping. */}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss tokens-cache banner"
            title="Dismiss for this session (re-appears next page load or when the affected blocks change)"
            className="float-right -mr-1 -mt-1 inline-flex h-6 w-6 items-center justify-center rounded text-amber-700 hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-900/40"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="font-medium">
            Tokens cache missing on this machine
          </div>
          <div className="mt-1 text-muted-foreground">
            This workspace was loaded from another machine, but its tokens
            cache files didn't travel with the bundle. Tokenised analyses
            (concordance tokens mode, token frequency, topic modelling) will
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
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={handleRetokeniseAll}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Re-tokenising…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  Re-tokenise all
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              Or open each block's settings menu (top-right gear icon) and
              pick Tokenise.
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TokensCacheRepairBanner;
