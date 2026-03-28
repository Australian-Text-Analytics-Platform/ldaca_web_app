import { Button } from '@/components/ui/button';

import type { WorkspaceDataTableHeaderInfo } from '../hooks/useWorkspaceDataTable';

interface WorkspaceDataHeaderProps {
  info: WorkspaceDataTableHeaderInfo;
  showTabMeta: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const WorkspaceDataHeader = ({
  info,
  showTabMeta,
  onUndo,
  onRedo,
  onDelete,
  canUndo = false,
  canRedo = false,
}: WorkspaceDataHeaderProps) => (
  <div className="flex-shrink-0 border-b border-border bg-muted p-2">
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium text-gray-700">Data View</h3>
        <span className="text-gray-300">|</span>
        <span className="text-sm font-semibold text-gray-800">{info.nodeLabel}</span>
        {showTabMeta && (
          <span className="text-xs text-gray-500">
            Viewing tab {info.tabPosition} of {info.totalTabs}
          </span>
        )}
        {info.isEmptyTable && (
          <span className="text-xs italic text-gray-500" aria-live="polite">
            (empty table)
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onUndo} disabled={!canUndo}>
          Undo
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onRedo} disabled={!canRedo}>
          Redo
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={onDelete} disabled={!onDelete}>
          Delete
        </Button>
      </div>
    </div>
  </div>
);
