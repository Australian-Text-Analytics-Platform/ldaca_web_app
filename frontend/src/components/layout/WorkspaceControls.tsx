import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { getInvalidWorkspaceNameMessage } from '@/features/workspace/common/workspaceName';
import HelpIcon from '@/components/help/HelpIcon';
import { useAuth } from '@/hooks/useAuth';
import { nodesApi } from '@/api/nodes';
import { queryKeys } from '@/lib/queryKeys';
import { parseDerivedColumn } from '@/types/index';
import type { GraphNode } from '@/types/api';

const MIN_BATCH_DELETE_COUNT = 3;
const MIN_BATCH_RETOKENISE_COUNT = 2;

function nodeHasTokensForm(node: GraphNode | undefined): boolean {
  const derived = node?.derived_columns;
  if (!Array.isArray(derived) || derived.length === 0) return false;
  return derived.some((raw) => {
    if (typeof raw !== 'string') return false;
    return parseDerivedColumn(raw)?.form === 'tokens';
  });
}

/**
 * Separated controls component focused only on workspace controls
 * Removed view mode toggle since both views are now shown vertically
 */
export const WorkspaceControls: React.FC = () => {
  const { currentWorkspace, currentWorkspaceId, workspaceGraph } = useWorkspaceData();
  const { renameWorkspace, deleteNode, clearSelection } = useWorkspaceActions();
  const { selectedNodeIds } = useWorkspaceSelection();
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(currentWorkspace?.name || '');
  const [nameAlertOpen, setNameAlertOpen] = useState(false);
  const [nameAlertMessage, setNameAlertMessage] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [retokeniseConfirmOpen, setRetokeniseConfirmOpen] = useState(false);
  const [isRetokenising, setIsRetokenising] = useState(false);

  useEffect(() => {
    setNameInput(currentWorkspace?.name || '');
  }, [currentWorkspace?.name]);

  const selectedCount = selectedNodeIds?.length ?? 0;
  const canBatchDelete = selectedCount >= MIN_BATCH_DELETE_COUNT;

  // Build the "to-be-deleted" list once per selection change. Roots (no
  // incoming edge in the graph) are bolded and pushed to the bottom of
  // the list so they sit next to the Cancel/Delete buttons — those are
  // the highest-impact deletions (orphan everything downstream when
  // the cascade kicks in) and the user benefits from seeing them last,
  // right above the action they're about to take.
  const selectedForDelete = useMemo(() => {
    if (!workspaceGraph || !selectedNodeIds || selectedNodeIds.length === 0) return [];
    const idSet = new Set(selectedNodeIds);
    const incomingTargets = new Set(workspaceGraph.edges.map((edge) => edge.target));
    const items = workspaceGraph.nodes
      .filter((node) => idSet.has(node.id))
      .map((node) => ({
        id: node.id,
        name: typeof node.name === 'string' && node.name.trim() ? node.name : node.id,
        isRoot: !incomingTargets.has(node.id),
      }));
    return items.sort((a, b) => {
      if (a.isRoot !== b.isRoot) return a.isRoot ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [workspaceGraph, selectedNodeIds]);

  // Selection × graph derived metadata → which selected nodes carry at
  // least one tokens-form derived column. The Re-tokenise button only
  // surfaces when ≥2 such nodes are selected. Nodes without tokens are
  // left out of the batch (they'd be silently skipped by the bulk endpoint
  // anyway, but excluding them up-front keeps the count honest).
  const tokenisedSelected = useMemo(() => {
    if (!workspaceGraph || !selectedNodeIds || selectedNodeIds.length === 0) {
      return [] as { id: string; name: string }[];
    }
    const byId = new Map(workspaceGraph.nodes.map((n) => [n.id, n]));
    return selectedNodeIds
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => Boolean(n) && nodeHasTokensForm(n))
      .map((n) => ({
        id: n.id,
        name: typeof n.name === 'string' && n.name.trim() ? n.name : n.id,
      }));
  }, [workspaceGraph, selectedNodeIds]);

  const canBatchRetokenise = tokenisedSelected.length >= MIN_BATCH_RETOKENISE_COUNT;

  const handleBatchRetokenise = async () => {
    if (!canBatchRetokenise || isRetokenising) return;
    setIsRetokenising(true);
    try {
      const result = await nodesApi.bulkRetokenise(
        tokenisedSelected.map((n) => n.id),
        getAuthHeaders(),
      );
      const ok = result.succeeded.length;
      const failed = result.failed.length;
      const skipped = result.skipped.length;
      if (ok > 0) {
        toast.success(
          `Re-tokenised ${ok} block${ok === 1 ? '' : 's'}` +
            (failed ? ` · ${failed} failed` : '') +
            (skipped ? ` · ${skipped} skipped` : ''),
        );
      } else if (failed > 0) {
        toast.error(
          `Re-tokenise failed: ${result.failed[0]?.error ?? 'unknown error'}`,
        );
      } else {
        toast.info('No blocks were re-tokenised.');
      }
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.workspaceGraph(currentWorkspaceId),
        });
      }
      setRetokeniseConfirmOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Re-tokenise failed: ${message}`);
    } finally {
      setIsRetokenising(false);
    }
  };

  const handleBatchDelete = async () => {
    if (!canBatchDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      // Settled, not all: if the backend cascades on parent removal, a
      // later child deletion may 404 — that's still the outcome the
      // user asked for, so don't abort the rest of the batch.
      await Promise.allSettled(
        selectedForDelete.map((item) => deleteNode(item.id)),
      );
      clearSelection?.();
      setDeleteConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRenameCommit = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === currentWorkspace?.name) {
      setIsEditing(false);
      return;
    }
    try {
      await renameWorkspace(trimmed);
    } catch (error) {
      const message = getInvalidWorkspaceNameMessage(error);
      if (message) {
        setNameAlertMessage(message);
        setNameAlertOpen(true);
      }
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <h3 className="text-sm font-medium text-gray-700">Workspace Graph View</h3>
      <HelpIcon targetKey="ui.workspace-graph-view" label="Workspace Graph View" className="h-5 w-5 text-muted-foreground" />
      <span className="text-gray-300">|</span>
      
      {isEditing ? (
        <input
          className="px-2 py-1 border rounded text-sm"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onBlur={handleRenameCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameCommit();
            if (e.key === 'Escape') setIsEditing(false);
          }}
          autoFocus
          aria-label="Workspace name"
        />
      ) : (
        <span className="text-sm font-semibold text-gray-800">
          {currentWorkspace?.name || 'No Workspace'}
        </span>
      )}

      {currentWorkspace && (
        <>
          {/* Edit name button with pencil icon */}
          <button
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
            onClick={() => setIsEditing((v) => !v)}
            title="Rename"
            aria-label="Rename workspace"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
              <path d="M16.862 3.487a1.5 1.5 0 0 1 2.121 0l1.53 1.53a1.5 1.5 0 0 1 0 2.122l-9.9 9.9a1.5 1.5 0 0 1-.53.352l-4.18 1.393a.75.75 0 0 1-.948-.948l1.392-4.18a1.5 1.5 0 0 1 .352-.53l9.9-9.9Z" />
              <path d="M18.26 2.08a3 3 0 0 1 4.243 0l.53.53a3 3 0 0 1 0 4.243l-1.06 1.06-4.773-4.773 1.06-1.06Z" />
            </svg>
            Rename
          </button>

          {/* Batch delete — only enabled with 3+ selected so this stays
              a deliberate, batch-only action. Per-node delete is still
              available from each node's context menu in the graph.
              Same size + shape in both states so the layout stays
              stable; only colours swap — destructive (red) when
              actionable, the existing muted/bordered look when not. */}
          <button
            className={`text-xs px-2 py-1 border rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              canBatchDelete && !isDeleting
                ? 'bg-destructive text-destructive-foreground border-destructive shadow-sm hover:bg-destructive/90 hover:border-destructive/90'
                : 'text-gray-600 hover:text-gray-800'
            }`}
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={!canBatchDelete || isDeleting}
            title={
              canBatchDelete
                ? 'Delete the selected data blocks'
                : `Select ${MIN_BATCH_DELETE_COUNT} or more data blocks to batch-delete`
            }
          >
            Delete ({selectedCount})
          </button>

          {/* Re-tokenise — overwrites existing tokenised columns on every
              selected block that already has at least one tokens-form
              derived column. Stays hidden when fewer than 2 such blocks
              are selected (per-block re-tokenise still lives in each
              node's settings menu). Re-uses each block's own
              (source_column, model, language) metadata so the user
              doesn't have to repeat that picker N times — handy after a
              cross-machine workspace import. */}
          {canBatchRetokenise && (
            <button
              className="text-xs px-2 py-1 border rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 text-gray-600 hover:text-gray-800"
              onClick={() => setRetokeniseConfirmOpen(true)}
              disabled={isRetokenising}
              title={`Re-tokenise existing token columns on ${tokenisedSelected.length} selected blocks using each block's recorded model + language`}
            >
              Re-tokenise ({tokenisedSelected.length})
            </button>
          )}
        </>
      )}

      <AlertDialog open={retokeniseConfirmOpen} onOpenChange={setRetokeniseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Re-tokenise {tokenisedSelected.length} data block{tokenisedSelected.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will overwrite the existing tokenised columns on each
              selected block, using the same model + language each block
              was originally tokenised with. Useful after a cross-machine
              workspace import where the donor's tokens cache didn't
              travel along.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-60 overflow-y-auto rounded border bg-muted/40 p-2 text-sm">
            {tokenisedSelected.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRetokenising}>Cancel</AlertDialogCancel>
            <Button asChild disabled={isRetokenising}>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleBatchRetokenise();
                }}
                disabled={isRetokenising}
              >
                {isRetokenising ? 'Re-tokenising…' : `Re-tokenise ${tokenisedSelected.length}`}
              </AlertDialogAction>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedForDelete.length} data block{selectedForDelete.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The following data blocks will be removed
              (root blocks — those with no parent — are bolded; deleting a
              root cascades to any downstream blocks too):
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-60 overflow-y-auto rounded border bg-muted/40 p-2 text-sm">
            {selectedForDelete.map((item) => (
              <li
                key={item.id}
                className={item.isRoot ? 'font-semibold' : undefined}
              >
                {item.name}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button asChild variant="destructive" disabled={isDeleting}>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleBatchDelete();
                }}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : `Delete ${selectedForDelete.length}`}
              </AlertDialogAction>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={nameAlertOpen} onOpenChange={setNameAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid workspace name</AlertDialogTitle>
            <AlertDialogDescription>
              {nameAlertMessage || 'Workspace names cannot include path separators or traversal sequences.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNameAlertOpen(false)}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
