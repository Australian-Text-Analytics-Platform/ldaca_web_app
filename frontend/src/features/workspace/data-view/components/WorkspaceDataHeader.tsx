import type { WorkspaceDataTableHeaderInfo } from '../hooks/useWorkspaceDataTable';

interface WorkspaceDataHeaderProps {
  info: WorkspaceDataTableHeaderInfo;
  showTabMeta: boolean;
}

export const WorkspaceDataHeader = ({ info, showTabMeta }: WorkspaceDataHeaderProps) => (
  <div className="flex-shrink-0 border-b border-border bg-muted p-2">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="text-sm font-medium text-gray-700">Data View</h3>
      <span className="text-gray-300">|</span>
      <span className="text-sm font-semibold text-gray-800">{info.nodeLabel}</span>
      <span className="text-xs text-gray-600">Shape: {info.shapeLabel}</span>
      <span className="text-xs text-gray-600">{info.rowsLoaded} rows loaded</span>
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
  </div>
);
