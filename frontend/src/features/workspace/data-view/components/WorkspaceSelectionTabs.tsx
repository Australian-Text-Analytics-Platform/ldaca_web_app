import { ChromeTabs, type ChromeTabItem } from '@/components/tabs';
import type { WorkspaceSelectionTabsState } from '../hooks/useWorkspaceDataTable';

type WorkspaceSelectionTabsProps = WorkspaceSelectionTabsState;

/**
 * Renders tabs for multi-selected workspace nodes in the data view.
 * Rendered by: WorkspaceDataTableFeature component (rg call sites/imports).
 * Why: because the data table feature needs selected-node tabs that switch the
 * active table without touching graph selection internals — reusing the same
 * Chrome-style ``ChromeTabs`` strip (drag-reorder + close) as the analysis views.
 * Flow: skip rendering when there is a single selection, otherwise adapt the
 * node tabs to the shared component and route activate/close/reorder back to the
 * data-table view model.
 */
export const WorkspaceSelectionTabs = ({
  shouldShowTabs,
  tabs,
  onTabChange,
  onTabClose,
  onTabReorder,
}: WorkspaceSelectionTabsProps) => {
  if (!shouldShowTabs) {
    return null;
  }

  const items: ChromeTabItem[] = tabs.map((tab) => ({ id: tab.id, title: tab.label }));
  const activeTabId = tabs.find((tab) => tab.isActive)?.id ?? null;

  return (
    <div className="border-b border-border/70 bg-muted/60 px-2 pt-2">
      <ChromeTabs
        aria-label="Selected node tabs"
        tabs={items}
        activeTabId={activeTabId}
        onActivate={onTabChange}
        onClose={onTabClose}
        onReorder={onTabReorder}
      />
    </div>
  );
};
