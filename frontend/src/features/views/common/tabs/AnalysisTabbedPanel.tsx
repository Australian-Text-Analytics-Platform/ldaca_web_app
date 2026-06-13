/**
 * Analysis-view tabbed panel: a Chrome-style tab strip above a single content
 * card. The strip itself (layout, drag-to-reorder, inline rename, close, "+")
 * lives in the shared ``ChromeTabs`` component; this wrapper only adapts the
 * analysis tab shape and draws the body card the active tab fuses into.
 *
 * Because this component draws its OWN card, the host must NOT wrap it in
 * another bordered card (WorkspaceShell neutralizes the main InsetCard frame for
 * tabbed views so this is the only visible card).
 *
 * Rendered by: AnalysisTabsHost, which every analysis view shares (concordance,
 * token-frequency, quotation, topic-modeling, sequential-analysis) by feeding
 * its own useWorkspaceTabs group + panel content.
 */
import { type ReactNode } from 'react';
import { ChromeTabs, type ChromeTabItem } from '@/components/tabs';
import type { AnalysisTab } from '@/api/generated/types.gen';

export interface AnalysisTabbedPanelProps {
  tabs: AnalysisTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
  onRename: (tabId: string, title: string) => void;
  /** Persists the final tab order (full list of ids) after a drag-and-drop. */
  onReorder: (orderedTabIds: string[]) => void;
  /** Content for the active tab, rendered inside the card below the strip. */
  children: ReactNode;
}

/**
 * Renders the analysis tab strip + content card.
 * Used by: AnalysisTabsHost because the host needs a presentational tabbed shell
 * decoupled from tab persistence (which lives in useWorkspaceTabs).
 * Flow: map analysis tabs to the shared ``ChromeTabs`` item shape, wire each
 * gesture to the host's intent callbacks, then render the active tab's children
 * inside a top-borderless card so the active tab fuses with it.
 */
export function AnalysisTabbedPanel({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCreate,
  onRename,
  onReorder,
  children,
}: AnalysisTabbedPanelProps) {
  const items: ChromeTabItem[] = tabs.map((tab) => ({
    id: tab.tab_id,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty title should fall back to 'Untitled'
    title: tab.title || 'Untitled',
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChromeTabs
        className="z-10 shrink-0 px-2 pt-1"
        aria-label="Analysis tabs"
        tabs={items}
        activeTabId={activeTabId}
        onActivate={onSelect}
        onClose={onClose}
        onCreate={onCreate}
        onRename={onRename}
        onReorder={onReorder}
        connectBelow
      />

      {/* The active tab owns the top edge; omitting the card's top border keeps
          the tab and panel visually fused instead of drawing a seam between them. */}
      <div className="-mt-px min-h-0 flex-1 overflow-auto rounded-xl border border-t-0 border-border/60 bg-white p-4 shadow-sm">
        {children}
      </div>
    </div>
  );
}
