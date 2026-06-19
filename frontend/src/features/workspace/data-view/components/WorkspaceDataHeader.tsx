import { useEffect, useState, useRef } from 'react';
import { Info, Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import HelpIcon from '@/components/help/HelpIcon';
import { cn } from '@/lib/utils';

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

/**
 * Keeps the selected data-node label on the header row while preserving the
 * useful trailing filename when space is tight.
 * Rendered by: WorkspaceDataHeader because its title row must not wrap under
 * the action buttons.
 * Flow: measure the label against its wrapper, switch to RTL clipping when it
 * overflows, and draw a muted left-edge fade over the hidden prefix.
 */
function HeaderNodeLabel({ label }: { label: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const text = textRef.current;
    if (!wrap || !text) return;
    const measure = () => {
      setOverflowing(text.offsetWidth > wrap.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    observer.observe(text);
    return () => { observer.disconnect(); };
  }, [label]);

  return (
    <span
      ref={wrapRef}
      dir={overflowing ? 'rtl' : 'ltr'}
      className="relative min-w-0 flex-1 overflow-hidden"
      data-testid="workspace-data-node-label"
      title={label}
    >
      <span
        ref={textRef}
        dir="ltr"
        className="block w-max whitespace-nowrap text-sm font-semibold text-gray-800"
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        data-testid="workspace-data-node-label-fade"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-14 bg-linear-to-r from-muted via-muted/90 to-transparent',
          overflowing ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  );
}

/**
 * Renders selected-node title, rename, query-plan, undo, and redo controls.
 * Rendered by: WorkspaceDataTableFeature component, WorkspaceDataHeader tests (rg call sites/imports).
 * Why: the data table feature needs the active node label and node-level actions
 * grouped in one compact line above the table state.
 * Flow: derive editable header state from node info, keep long labels clipped
 * with a leading fade, run inline rename, and expose icon-only actions beside
 * the table.
 */
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

  /**
   * Commits a node rename when the inline editor blurs or submits.
   * Called by: WorkspaceDataHeader internal event, effect, or helper flow.
   * Why: because the data table feature needs node title, save, refresh, and collapse actions grouped above the table state.
   */
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

  /**
   * Opens inline node rename mode and focuses the draft input.
   * Called by: WorkspaceDataHeader internal event, effect, or helper flow.
   * Why: because the data table feature needs node title, save, refresh, and collapse actions grouped above the table state.
   */
  const startRename = () => {
    setRenameDraft({ baseLabel: info.nodeLabel, value: info.nodeLabel });
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
  };

  /**
   * Fetches and opens the Polars query plan dialog for the active node.
   * Called by: WorkspaceDataHeader internal event, effect, or helper flow.
   * Why: because the data table feature needs node title, save, refresh, and collapse actions grouped above the table state.
   */
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
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="shrink-0 text-sm font-medium text-gray-700">Data View</h3>
        <HelpIcon
          targetKey="ui.data-viewer"
          label="Data Viewer"
          className="h-5 w-5 shrink-0 text-muted-foreground"
        />
        <span className="shrink-0 text-gray-300">|</span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isRenaming ? (
            <input
              ref={inputRef}
              className="min-w-0 flex-1 rounded border px-2 py-0.5 text-sm font-semibold text-gray-800"
              value={renameDraft.value}
              onChange={(e) => { setRenameDraft({ baseLabel: info.nodeLabel, value: e.target.value }); }}
              onBlur={handleRenameCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameCommit();
                if (e.key === 'Escape') setRenameDraft(undefined);
              }}
              aria-label="Node name"
            />
          ) : (
            <HeaderNodeLabel label={info.nodeLabel} />
          )}
          {onRename && !isRenaming && (
            <button
              className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-gray-600 hover:text-gray-800"
              onClick={startRename}
              title="Rename"
              aria-label="Rename node"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-3 w-3"
              >
                <path d="M16.862 3.487a1.5 1.5 0 0 1 2.121 0l1.53 1.53a1.5 1.5 0 0 1 0 2.122l-9.9 9.9a1.5 1.5 0 0 1-.53.352l-4.18 1.393a.75.75 0 0 1-.948-.948l1.392-4.18a1.5 1.5 0 0 1 .352-.53l9.9-9.9Z" />
                <path d="M18.26 2.08a3 3 0 0 1 4.243 0l.53.53a3 3 0 0 1 0 4.243l-1.06 1.06-4.773-4.773 1.06-1.06Z" />
              </svg>
              Rename
            </button>
          )}
          {info.isEmptyTable && (
            <span className="shrink-0 text-xs italic text-gray-500" aria-live="polite">
              (empty table)
            </span>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={() => {
              void handleOpenQueryPlan();
            }}
            disabled={!onQueryPlan}
            aria-label="Info"
            title="Info"
          >
            <Info className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
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
