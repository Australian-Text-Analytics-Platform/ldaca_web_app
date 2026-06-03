/**
 * Reusable browser-style tabbed panel for analysis views. It renders a slim
 * strip of folder tabs that PROTRUDE above a single content card, then the card
 * itself wrapping the active tab's content (passed as ``children``).
 *
 * Visual contract (the look the design calls for):
 *  - The tab strip occupies a slim band at the very top. The content card below
 *    is therefore shorter than the full column height, leaving that band free.
 *  - The active tab is a white folder whose open bottom edge overlaps the card's
 *    top border (``-mb-px`` + ``z-10``) so the tab reads as a protrusion of the
 *    card — one continuous, non-rectangular surface with no divider line.
 *  - Inactive tabs sit recessed on the same baseline in a muted fill.
 *
 * Because this component draws its OWN card, the host must NOT wrap it in
 * another bordered card (WorkspaceShell neutralizes the main InsetCard frame for
 * tabbed views so this is the only visible card).
 *
 * Behaviour:
 *  - Horizontally scrollable when tabs overflow (no wrap, thin scrollbar).
 *  - Clicking an inactive tab selects it; clicking the already-active tab's
 *    title starts an inline rename (Enter commits, Escape/blur cancels).
 *  - Per-tab × closes (hidden when only one tab remains).
 *  - A ``+`` button follows the last tab to create a new one.
 *
 * Rendered by: AnalysisTabsHost, which every analysis view shares (concordance,
 * token-frequency, quotation, topic-modeling, sequential-analysis) by feeding
 * its own useWorkspaceTabs group + panel content.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnalysisTab } from '@/api/generated/types.gen';

export interface AnalysisTabbedPanelProps {
  tabs: AnalysisTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
  onRename: (tabId: string, title: string) => void;
  /** Content for the active tab, rendered inside the card below the strip. */
  children: ReactNode;
}

/**
 * Renders the protruding tab strip + content card and owns only transient
 * inline-rename state.
 * Used by: AnalysisTabsHost because the host needs a presentational tabbed shell
 * decoupled from tab persistence (which lives in useWorkspaceTabs).
 * Flow: map tabs to folder buttons (active one merges into the card top), swap
 * the active tab's label for an input while renaming, and route every gesture to
 * the parent's intent callbacks. The card hosts the active tab's children.
 */
export function AnalysisTabbedPanel({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCreate,
  onRename,
  children,
}: AnalysisTabbedPanelProps) {
  // Which tab is currently being renamed (null = none) + its draft text.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus + select the input when an inline rename begins so the user can type
  // over the old title immediately.
  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  const beginRename = (tab: AnalysisTab) => {
    setRenamingId(tab.tab_id);
    setDraftTitle(tab.title ?? '');
  };

  const commitRename = () => {
    if (renamingId) {
      const trimmed = draftTitle.trim();
      if (trimmed) onRename(renamingId, trimmed);
    }
    setRenamingId(null);
  };

  const cancelRename = () => setRenamingId(null);

  // Single-click behaviour: select an inactive tab, or rename the active one.
  const handleTitleClick = (tab: AnalysisTab) => {
    if (tab.tab_id === activeTabId) beginRename(tab);
    else onSelect(tab.tab_id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Slim protruding tab band. ``items-end`` drops every tab onto the card's
          top edge; ``relative z-10`` lets the active tab paint over that edge. */}
      <div
        className="relative z-10 flex shrink-0 items-end overflow-x-auto px-2 pt-1"
        role="tablist"
        aria-label="Analysis tabs"
      >
        <div className="flex min-w-0 items-end gap-1">
          {tabs.map((tab) => {
            const isActive = tab.tab_id === activeTabId;
            const isRenaming = tab.tab_id === renamingId;
            return (
              <div
                key={tab.tab_id}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  'group flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 text-sm transition-colors',
                  isActive
                    ? // White folder: borders on top/sides, no bottom, pulled down
                      // 1px over the card's top border so it protrudes from the card.
                      '-mb-px border border-b-0 border-border/60 bg-white py-2 font-medium text-gray-900 shadow-[0_-2px_4px_-2px_rgba(0,0,0,0.12)]'
                    : // Recessed muted tab sitting on the card's top edge.
                      'mb-px border border-transparent bg-gray-100/80 py-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700',
                )}
              >
                {isRenaming ? (
                  <input
                    ref={inputRef}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      else if (e.key === 'Escape') cancelRename();
                    }}
                    className="w-28 bg-transparent text-sm outline-none"
                    aria-label="Rename tab"
                  />
                ) : (
                  <button
                    type="button"
                    className="max-w-48 truncate text-left"
                    onClick={() => handleTitleClick(tab)}
                    title={isActive ? 'Click to rename' : (tab.title ?? 'Untitled')}
                  >
                    {tab.title || 'Untitled'}
                  </button>
                )}
                {tabs.length > 1 && !isRenaming && (
                  <button
                    type="button"
                    aria-label="Close tab"
                    className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(tab.tab_id);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            aria-label="New tab"
            className="mb-1 ml-0.5 shrink-0 self-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800"
            onClick={onCreate}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* The single content card. ``flex-1`` makes it fill the remaining height
          below the slim tab band, so it ends up shorter than the sidebar. */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/60 bg-white p-4 shadow-sm">
        {children}
      </div>
    </div>
  );
}
