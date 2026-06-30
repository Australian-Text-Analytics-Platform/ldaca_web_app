/**
 * Analysis-view tabbed panel: a Chrome-style tab strip above a single content
 * card. The strip itself (layout, drag-to-reorder, inline rename, close, "+")
 * lives in the shared ``ChromeTabs`` component; this wrapper only adapts the
 * analysis tab shape, optionally hides the strip for the multi-tab preference,
 * and draws the body card for the active tab.
 *
 * Because this component draws its OWN card, the host must NOT wrap it in
 * another bordered card (WorkspaceShell neutralizes the main InsetCard frame for
 * tabbed views so this is the only visible card).
 *
 * Rendered by: AnalysisTabsHost, which every analysis-style view shares
 * (concordance, token-frequency, quotation, topic-modeling,
 * sequential-analysis, annotation) by feeding its own useWorkspaceTabs group +
 * panel content.
 */
import { type ReactNode } from 'react';
import { ChromeTabs, type ChromeTabItem } from '@/components/tabs';
import type { AnalysisTab } from '@/api';
import { cn } from '@/lib/utils';

export interface AnalysisTabbedPanelProps {
  tabs: AnalysisTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
  onRename: (tabId: string, title: string) => void;
  /** Persists the final tab order (full list of ids) after a drag-and-drop. */
  onReorder: (orderedTabIds: string[]) => void;
  /** Whether the user preference should expose create/select/close/rename tab controls. */
  multiTabEnabled?: boolean;
  /** Content for the active tab, rendered inside the card below the strip. */
  children: ReactNode;
}

/**
 * Renders the analysis content card and optional tab strip.
 * Used by: AnalysisTabsHost because the host needs a presentational tabbed shell
 * decoupled from tab persistence (which lives in useWorkspaceTabs).
 * Flow: map analysis tabs to the shared ``ChromeTabs`` item shape, wire each
 * gesture to the host's intent callbacks when multi-tab UI is enabled, then
 * always render the active tab's children inside the analysis card.
 */
export function AnalysisTabbedPanel({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCreate,
  onRename,
  onReorder,
  multiTabEnabled = false,
  children,
}: AnalysisTabbedPanelProps) {
  const items: ChromeTabItem[] = tabs.map((tab) => ({
    id: tab.tab_id,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty title should fall back to 'Untitled'
    title: tab.title || 'Untitled',
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {multiTabEnabled ? (
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
      ) : null}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-auto rounded-xl border border-border/60 bg-white p-4 shadow-sm',
          multiTabEnabled ? '-mt-px border-t-0' : null,
        )}
      >
        {children}
      </div>
    </div>
  );
}
