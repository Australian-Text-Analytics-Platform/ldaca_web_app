/**
 * Analysis-view editor surface with an optional shared tab strip. The strip
 * owns layout and interactions while this wrapper adapts analysis tabs and
 * frames the strip and active content as one continuous surface.
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
import { type EditorTabItem, EditorTabs } from '@/components/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AnalysisTab } from './tabStateOps';

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
  /** Content for the active tab, rendered inside the editor surface. */
  children: ReactNode;
}

/**
 * Renders the analysis editor surface and optional tab strip.
 * Used by: AnalysisTabsHost because the host needs a presentational tabbed shell
 * decoupled from tab persistence (which lives in useWorkspaceTabs).
 * Flow: map analysis tabs to the shared ``EditorTabs`` item shape, wire each
 * gesture to the host's intent callbacks when multi-tab UI is enabled, then
 * always render the active tab's children inside the analysis surface.
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
  const items: EditorTabItem[] = tabs.map((tab) => ({
    id: tab.tab_id,

    title: tab.title || 'Untitled',
  }));

  return (
    <div
      data-testid="analysis-editor-surface"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-surface-border/60 bg-surface"
    >
      {multiTabEnabled ? (
        <EditorTabs
          className="shrink-0"
          aria-label="Analysis tabs"
          tabs={items}
          activeTabId={activeTabId}
          onActivate={onSelect}
          onClose={onClose}
          onCreate={onCreate}
          onRename={onRename}
          onReorder={onReorder}
        />
      ) : null}

      <ScrollArea
        data-testid="analysis-editor-content"
        scrollbars="both"
        className="min-h-0 flex-1 bg-surface"
      >
        <div className="min-h-full p-4">{children}</div>
      </ScrollArea>
    </div>
  );
}
