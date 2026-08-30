import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Tab } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  analysisNavigationForKind,
  analysisNavigationForView,
  analysisTabQuickAccessLabel,
  filterAnalysisTabs,
} from '@/features/views/common/analysisNavigation';
import {
  analysisTabsPresentationKey,
  useAnalysisTabsPresentationStore,
} from '@/features/views/common/tabs/analysisTabsPresentationStore';
import { useWorkspaceTabResources } from '@/features/views/common/tabs/workspaceTabsQuery';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { isMacOSDesktop } from '@/lib/isMacOSDesktop';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import {
  createDesktopNavigationHistory,
  type DesktopNavigationLocation,
  moveDesktopNavigation,
  pruneDesktopNavigationTabs,
  recordDesktopNavigation,
} from './desktopNavigationHistory';

interface DesktopNavigationHeaderViewProps {
  workspaceName: string;
  tabs: Tab[];
  unavailableTabWarnings?: string[];
  currentTabId: string | null;
  isLoading: boolean;
  isError: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onSelectTab: (tab: Tab) => void;
  onRetry: () => void;
}

const EMPTY_TABS: Tab[] = [];

/** VS Code-style macOS title-bar controls with a searchable Workspace Tab picker. */
export function DesktopNavigationHeaderView({
  workspaceName,
  tabs,
  unavailableTabWarnings = [],
  currentTabId,
  isLoading,
  isError,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onSelectTab,
  onRetry,
}: DesktopNavigationHeaderViewProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filteredTabs = filterAnalysisTabs(tabs, query);
  const selectedIndex = Math.min(highlightedIndex, Math.max(filteredTabs.length - 1, 0));

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setQuery('');
      setHighlightedIndex(0);
    }
  };

  const chooseTab = (tab: Tab) => {
    onSelectTab(tab);
    setOpen(false);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((index) =>
        filteredTabs.length === 0 ? 0 : (index + 1) % filteredTabs.length,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((index) =>
        filteredTabs.length === 0 ? 0 : (index - 1 + filteredTabs.length) % filteredTabs.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      const tab = filteredTabs[selectedIndex];
      if (tab) {
        event.preventDefault();
        chooseTab(tab);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <header
      data-testid="desktop-navigation-header"
      data-tauri-drag-region="deep"
      className="fixed inset-x-0 top-0 z-30 flex h-(--desktop-titlebar-height) select-none items-center bg-[var(--vscode-titleBar-activeBackground)] text-[var(--vscode-titleBar-activeForeground)]"
    >
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center">
        <nav
          aria-label="Navigation history"
          data-tauri-drag-region="false"
          className="flex items-center gap-1"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-tauri-drag-region="false"
            className="size-[22px] rounded-md text-[var(--vscode-titleBar-activeForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] disabled:opacity-40"
            aria-label="Go back"
            disabled={!canGoBack}
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-tauri-drag-region="false"
            className="size-[22px] rounded-md text-[var(--vscode-titleBar-activeForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] disabled:opacity-40"
            aria-label="Go forward"
            disabled={!canGoForward}
            onClick={onForward}
          >
            <ArrowRight className="size-4" />
          </Button>
        </nav>

        <Popover open={open} onOpenChange={changeOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-tauri-drag-region="false"
              className="ml-1.5 flex h-[22px] w-[38vw] max-w-[600px] min-w-48 items-center justify-center gap-1.5 overflow-hidden rounded-md border border-[var(--vscode-commandCenter-border)] bg-[var(--vscode-commandCenter-background)] px-2 text-label text-[var(--vscode-commandCenter-foreground)] outline-hidden hover:border-[var(--vscode-commandCenter-activeBorder)] hover:bg-[var(--vscode-commandCenter-activeBackground)] hover:text-[var(--vscode-commandCenter-activeForeground)] focus-visible:border-[var(--vscode-commandCenter-activeBorder)]"
              aria-label="Open quick access"
            >
              <Search className="size-3.5 shrink-0 opacity-80" />
              <span className="min-w-0 truncate">{workspaceName}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            side="bottom"
            sideOffset={-22}
            className="w-[min(600px,calc(100vw-2rem))] border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-quickInput-background)] p-2 text-[var(--vscode-quickInput-foreground)]"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchInputRef.current?.focus();
            }}
          >
            <Input
              ref={searchInputRef}
              value={query}
              placeholder="Search analysis tabs…"
              aria-label="Search analysis tabs"
              className="mb-2 h-8 px-2 text-body"
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />

            <div
              role="listbox"
              aria-label="Workspace analysis tabs"
              className="max-h-[50vh] overflow-y-auto"
            >
              {unavailableTabWarnings.map((warning) => (
                <p
                  role="alert"
                  key={warning}
                  className="mx-2 mb-2 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1.5 text-body text-warning"
                >
                  {warning}
                </p>
              ))}
              {isLoading ? (
                <p className="px-2 py-4 text-center text-body text-description">Loading Tabs…</p>
              ) : isError ? (
                <div className="flex items-center justify-between gap-3 px-2 py-3">
                  <p className="text-body text-error">Could not load Workspace Tabs.</p>
                  <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                </div>
              ) : workspaceName === 'No workspace' ? (
                <p className="px-2 py-4 text-center text-body text-description">
                  Load a Workspace to access analysis Tabs.
                </p>
              ) : tabs.length === 0 ? (
                <p className="px-2 py-4 text-center text-body text-description">
                  This Workspace has no analysis Tabs.
                </p>
              ) : filteredTabs.length === 0 ? (
                <p className="px-2 py-4 text-center text-body text-description">
                  No Tabs match “{query}”.
                </p>
              ) : (
                filteredTabs.map((tab, index) => {
                  const selected = tab.id === currentTabId;
                  const highlighted = index === selectedIndex;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      key={tab.id}
                      className={`flex w-full items-center rounded-sm px-2 py-1.5 text-left text-body text-foreground outline-hidden ${
                        highlighted ? 'bg-list-active' : 'hover:bg-list-hover'
                      } ${selected ? 'font-semibold' : ''}`}
                      onMouseMove={() => {
                        setHighlightedIndex(index);
                      }}
                      onClick={() => {
                        chooseTab(tab);
                      }}
                    >
                      <span className="truncate">{analysisTabQuickAccessLabel(tab)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}

/** Connects desktop title-bar controls to Workspace Tabs and session navigation history. */
export function DesktopNavigationHeader() {
  if (!isMacOSDesktop()) return null;
  return <DesktopNavigationHeaderController />;
}

function DesktopNavigationHeaderController() {
  const { currentWorkspace, currentWorkspaceId } = useWorkspaceData();
  const userId = useAuthStore((state) => state.session?.user?.id ?? '__anonymous__');
  const currentView = useUIStore((state) => state.currentView);
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const activeTabIds = useAnalysisTabsPresentationStore((state) => state.activeTabIds);
  const rememberActiveTab = useAnalysisTabsPresentationStore((state) => state.rememberActiveTab);
  const tabsQuery = useWorkspaceTabResources(currentWorkspaceId);
  const tabResources = tabsQuery.data ?? EMPTY_TABS;
  const tabs = tabResources.filter((tab): tab is Tab => tab.availability === 'available');
  const unavailableTabWarnings = tabResources
    .filter((tab) => tab.availability === 'unavailable')
    .map((tab) => tab.warning);
  const currentAnalysis = analysisNavigationForView(currentView);
  const storedActiveTabId = currentAnalysis
    ? (activeTabIds[
        analysisTabsPresentationKey(userId, currentWorkspaceId, currentAnalysis.kind)
      ] ?? null)
    : null;
  const currentTab = currentAnalysis
    ? (tabs.find((tab) => tab.kind === currentAnalysis.kind && tab.id === storedActiveTabId) ??
      tabs.find((tab) => tab.kind === currentAnalysis.kind) ??
      null)
    : null;
  const currentTabId = currentTab?.id ?? null;
  const locationReady = !currentAnalysis || !currentWorkspaceId || !tabsQuery.isLoading;
  const [history, setHistory] = useState(() => createDesktopNavigationHistory(currentWorkspaceId));
  const applyingHistoryRef = useRef<DesktopNavigationLocation | null>(null);

  useEffect(() => {
    const location: DesktopNavigationLocation = currentTabId
      ? { view: currentView, tabId: currentTabId }
      : { view: currentView };
    const applying = applyingHistoryRef.current;
    const applyingReached = applying?.view === location.view && applying.tabId === location.tabId;
    if (applyingReached) {
      applyingHistoryRef.current = null;
    }
    setHistory((current) => {
      let next =
        current.workspaceId === currentWorkspaceId
          ? current
          : createDesktopNavigationHistory(currentWorkspaceId);
      if (tabsQuery.isSuccess) {
        next = pruneDesktopNavigationTabs(next, new Set(tabs.map((tab) => tab.id)));
      }
      if (!locationReady || applyingReached) return next;
      return recordDesktopNavigation(next, currentWorkspaceId, location);
    });
  }, [currentTabId, currentView, currentWorkspaceId, locationReady, tabs, tabsQuery.isSuccess]);

  const applyHistoryLocation = (location: DesktopNavigationLocation) => {
    applyingHistoryRef.current = location;
    if (location.tabId && currentWorkspaceId) {
      const tab = tabs.find((item) => item.id === location.tabId);
      if (tab) rememberActiveTab(userId, currentWorkspaceId, tab.kind, tab.id);
    }
    setCurrentView(location.view);
  };

  const moveHistory = (direction: -1 | 1) => {
    const moved = moveDesktopNavigation(history, direction);
    if (!moved.location) return;
    setHistory(moved.history);
    applyHistoryLocation(moved.location);
  };

  return (
    <DesktopNavigationHeaderView
      workspaceName={currentWorkspace?.name ?? 'No workspace'}
      tabs={tabs}
      currentTabId={currentTabId}
      unavailableTabWarnings={unavailableTabWarnings}
      isLoading={Boolean(currentWorkspaceId) && tabsQuery.isLoading}
      isError={tabsQuery.isError}
      canGoBack={history.workspaceId === currentWorkspaceId && history.index > 0}
      canGoForward={
        history.workspaceId === currentWorkspaceId && history.index < history.entries.length - 1
      }
      onBack={() => {
        moveHistory(-1);
      }}
      onForward={() => {
        moveHistory(1);
      }}
      onSelectTab={(tab) => {
        if (!currentWorkspaceId) return;
        rememberActiveTab(userId, currentWorkspaceId, tab.kind, tab.id);
        setCurrentView(analysisNavigationForKind(tab.kind).view);
      }}
      onRetry={() => {
        void tabsQuery.refetch();
      }}
    />
  );
}
