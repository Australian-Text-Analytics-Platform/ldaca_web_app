import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import HelpIcon from '@/components/help/HelpIcon';

import type { WorkspaceDataTableHeaderInfo } from '../hooks/useWorkspaceDataTable';

interface WorkspaceDataHeaderProps {
  info: WorkspaceDataTableHeaderInfo;
  onUndo?: () => void;
  onRedo?: () => void;
  onRename?: (newName: string) => void;
  onQueryPlan?: () => Promise<string | null>;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const WorkspaceDataHeader = ({
  info,
  onUndo,
  onRedo,
  onRename,
  onQueryPlan,
  canUndo = false,
  canRedo = false,
}: WorkspaceDataHeaderProps) => {
  const [renameDraft, setRenameDraft] = useState<{ baseLabel: string; value: string }>();
  const [queryPlanOpen, setQueryPlanOpen] = useState(false);
  const [queryPlan, setQueryPlan] = useState<string | null>(null);
  const [queryPlanLoading, setQueryPlanLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isRenaming = renameDraft?.baseLabel === info.nodeLabel;

  const handleRenameCommit = () => {
    if (!isRenaming) {
      return;
    }
    const trimmed = renameDraft.value.trim();
    if (trimmed && trimmed !== info.nodeLabel && onRename) {
      onRename(trimmed);
    }
    setRenameDraft(undefined);
  };

  const startRename = () => {
    setRenameDraft({ baseLabel: info.nodeLabel, value: info.nodeLabel });
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
  };

  const handleOpenQueryPlan = async () => {
    setQueryPlanOpen(true);
    setQueryPlan(null);
    setQueryPlanLoading(true);
    try {
      const plan = onQueryPlan ? await onQueryPlan() : null;
      setQueryPlan(plan);
    } finally {
      setQueryPlanLoading(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-border bg-muted p-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <h3 className="text-sm font-medium text-gray-700">Data View</h3>
          <HelpIcon targetKey="ui.data-viewer" label="Data Viewer" className="h-5 w-5 text-muted-foreground" />
          <span className="text-gray-300">|</span>
          {isRenaming ? (
            <input
              ref={inputRef}
              className="px-2 py-0.5 border rounded text-sm font-semibold text-gray-800"
              value={renameDraft.value}
              onChange={(e) => setRenameDraft({ baseLabel: info.nodeLabel, value: e.target.value })}
              onBlur={handleRenameCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameCommit();
                if (e.key === 'Escape') setRenameDraft(undefined);
              }}
              aria-label="Node name"
            />
          ) : (
            <span className="text-sm font-semibold text-gray-800">{info.nodeLabel}</span>
          )}
          {onRename && !isRenaming && (
            <button
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 px-1.5 py-0.5 border rounded"
              onClick={startRename}
              title="Rename"
              aria-label="Rename node"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                <path d="M16.862 3.487a1.5 1.5 0 0 1 2.121 0l1.53 1.53a1.5 1.5 0 0 1 0 2.122l-9.9 9.9a1.5 1.5 0 0 1-.53.352l-4.18 1.393a.75.75 0 0 1-.948-.948l1.392-4.18a1.5 1.5 0 0 1 .352-.53l9.9-9.9Z" />
                <path d="M18.26 2.08a3 3 0 0 1 4.243 0l.53.53a3 3 0 0 1 0 4.243l-1.06 1.06-4.773-4.773 1.06-1.06Z" />
              </svg>
              Rename
            </button>
          )}
          {info.isEmptyTable && (
            <span className="text-xs italic text-gray-500" aria-live="polite">
              (empty table)
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleOpenQueryPlan} disabled={!onQueryPlan}>
            Info
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onUndo} disabled={!canUndo}>
            Undo
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onRedo} disabled={!canRedo}>
            Redo
          </Button>
        </div>
      </div>

      <Dialog open={queryPlanOpen} onOpenChange={setQueryPlanOpen}>
        <DialogContent className="flex h-[88vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden p-0 sm:max-w-[96vw]">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
            <DialogTitle>Query Plan</DialogTitle>
            <DialogDescription>
              Polars LazyFrame execution plan for <strong>{info.nodeLabel}</strong>
            </DialogDescription>
          </DialogHeader>
          {queryPlanLoading ? (
            <div className="flex flex-1 items-center gap-2 px-6 pb-6 text-sm text-muted-foreground">
              <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              Loading query plan…
            </div>
          ) : (
            <div className="min-h-0 flex-1 px-6 pb-6">
              <div className="h-full overflow-x-scroll overflow-y-auto rounded-md bg-muted p-4">
                <pre className="min-w-max whitespace-pre text-xs font-mono leading-relaxed">
                  {queryPlan ?? 'No plan available.'}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
