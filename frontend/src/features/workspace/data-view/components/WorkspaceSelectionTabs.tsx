import { EditorTabs, type EditorTabItem } from '@/components/tabs';
import { GREY, VIZ_TINT_FOREGROUND, toBgColor } from '@/features/views/common/vizPalette';
import { normalizeNodeAccentColor } from '@/lib/nodeColor';
import type { WorkspaceSelectionTabsState } from '../hooks/useWorkspaceDataTable';

/** Lighter mix used for inactive tabs so the active Data Block tint stands out. */
const INACTIVE_TAB_TINT_MIX = 0.08;

type WorkspaceSelectionTabsProps = WorkspaceSelectionTabsState;

/**
 * Renders tabs for multi-selected workspace nodes in the data view.
 * Rendered by: WorkspaceDataTableFeature component.
 * Why: because the data table feature needs selected-node tabs that switch the
 * active table without touching graph selection internals — reusing the same
 * ``EditorTabs`` strip (drag-reorder + close) as the analysis views.
 * Flow: skip rendering when there is a single selection, otherwise adapt the
 * node tabs to the shared component, colour each tab with its Data Block tint
 * (the standard tint when active, a lighter one when inactive), and route
 * activate/close/reorder back to the data-table view model.
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

  const items: EditorTabItem[] = tabs.map((tab) => {
    const color = normalizeNodeAccentColor(tab.color) ?? GREY;
    return {
      id: tab.id,
      title: tab.label,
      fill: {
        active: toBgColor(color),
        inactive: toBgColor(color, INACTIVE_TAB_TINT_MIX),
        foreground: VIZ_TINT_FOREGROUND,
      },
    };
  });
  const activeTabId = tabs.find((tab) => tab.isActive)?.id ?? null;

  return (
    <EditorTabs
      className="shrink-0"
      aria-label="Selected node tabs"
      tabs={items}
      activeTabId={activeTabId}
      onActivate={onTabChange}
      onClose={onTabClose}
      onReorder={onTabReorder}
    />
  );
};
