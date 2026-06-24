import { useEffect, Suspense, lazy } from 'react';
import { usePreferencesInit } from '@/hooks/usePreferences';
import { useSidebarResize } from '@/hooks/useSidebarResize';
import { useRightPanelResize } from '@/hooks/useRightPanelResize';
import { QueryProvider } from '@/providers/QueryProvider';
import { WorkspaceProvider } from '@/features/workspace/common/WorkspaceProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import Sidebar from '@/components/layout/Sidebar';
import { InsetCard } from '@/components/layout/InsetCard';
import { RefreshStatusBanner } from '@/features/auth/components/RefreshStatusBanner';
import { useUIStore } from '@/stores';
import type { ViewType } from '@/stores';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useSingleTabModeWorkspaceCleanup } from '@/features/views/common/tabs/useSingleTabModeWorkspaceCleanup';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { DocumentModalHost } from '@/components/dialogs/DocumentModalHost';
import { ViewRouteSync } from '@/components/layout/ViewRouteSync';
import { ViewRouter } from '@/components/layout/ViewRouter';

const FeedbackPanel = lazy(() =>
  import('@/features/feedback/components/FeedbackPanel').then((m) => ({
    default: m.FeedbackPanel,
  })),
);
const WorkspaceView = lazy(() => import('@/components/layout/WorkspaceView'));
const HintsController = lazy(() =>
  import('@/features/hints/HintsController').then((m) => ({ default: m.HintsController })),
);

/**
 * Views that render their own tabbed card (AnalysisTabbedPanel via
 * AnalysisTabsHost) instead of sitting inside the shared main card. For these,
 * the main InsetCard frame is made transparent so the tab strip can protrude
 * above the view's own card with no double-card nesting. Every analysis view
 * that has migrated to the shared tab shell must be listed here.
 */
const TABBED_MAIN_VIEWS = new Set<ViewType>([
  'concordance',
  'token-frequency',
  'analysis',
  'topic-modeling',
  'quotation',
]);

/**
 * Headless bridge between the global multi-tab preference and workspace tab
 * persistence.
 * Rendered by: WorkspaceShell under WorkspaceProvider so it can see the current
 * workspace even when no analysis view is mounted.
 */
function SingleTabModeWorkspaceCleanup() {
  const analysisMultiTabEnabled = usePreferencesStore((state) => state.analysisMultiTabEnabled);
  const { currentWorkspaceId } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();
  useSingleTabModeWorkspaceCleanup(currentWorkspaceId, analysisMultiTabEnabled, getAuthHeaders);
  return null;
}

export function WorkspaceShell() {
  const { feedbackOpen, closeModal } = useUIStore(
    useShallow((state) => ({
      feedbackOpen: state.modals.feedback,
      closeModal: state.closeModal,
    })),
  );

  usePreferencesInit();
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const syncVisibleViews = useUIStore((s) => s.syncVisibleViewsFromPreferences);
  const currentView = useUIStore((s) => s.currentView);
  const isTabbedMain = TABBED_MAIN_VIEWS.has(currentView);
  useEffect(() => {
    if (prefsHydrated) syncVisibleViews();
  }, [prefsHydrated, syncVisibleViews]);

  const {
    containerRef: sidebarHostRef,
    value: sidebarWidth,
    isDragging: isResizingSidebar,
    splitterProps: sidebarSplitterProps,
  } = useSidebarResize();

  const {
    layoutRef,
    asidePanelRatio,
    isResizing,
    rightPanelSplitterProps,
    isRightCollapsed,
    toggleRightPanel,
    mainRef,
    asideRef,
  } = useRightPanelResize();

  return (
    <QueryProvider>
      <WorkspaceProvider>
        <SingleTabModeWorkspaceCleanup />
        <ViewRouteSync />
        <ErrorBoundary>
          <SidebarProvider
            className="bg-linear-to-br from-slate-50 to-blue-50"
            style={{ ['--sidebar-width' as string]: `${String(sidebarWidth)}px` }}
          >
            <DocumentModalHost />
            <RefreshStatusBanner />
            <Suspense fallback={null}>
              <HintsController />
            </Suspense>
            <div className="flex h-dvh w-full overflow-hidden" ref={sidebarHostRef}>
              <ErrorBoundary>
                <Sidebar />
              </ErrorBoundary>

              <div
                className={`group relative hidden w-2 shrink-0 cursor-col-resize items-center justify-center md:flex ${isResizingSidebar ? 'z-20' : ''}`}
                aria-label="Resize sidebar"
                {...sidebarSplitterProps}
              >
                <div
                  className={`pointer-events-none h-10 w-1 rounded-full transition-colors ${
                    isResizingSidebar ? 'bg-gray-500' : 'bg-gray-300 group-hover:bg-gray-500'
                  }`}
                />
              </div>

              <SidebarInset className="flex h-full flex-1 flex-col overflow-hidden bg-transparent md:m-0! md:ml-0! md:rounded-none! md:shadow-none!">
                <Suspense fallback={null}>
                  <FeedbackPanel
                    open={feedbackOpen}
                    onClose={() => {
                      closeModal('feedback');
                    }}
                  />
                </Suspense>

                <header className="border-border/40 border-b bg-white px-4 py-3 md:hidden">
                  <div className="flex items-center justify-between">
                    <SidebarTrigger />
                  </div>
                </header>

                <div className="flex flex-1 flex-col overflow-hidden">
                  {/* Below md, stack panes so desktop resize widths cannot force horizontal overflow. */}
                  <div
                    className="relative flex flex-1 overflow-hidden max-md:flex-col max-md:overflow-y-auto"
                    ref={layoutRef}
                  >
                    <InsetCard
                      ref={mainRef}
                      role="main"
                      className={`relative h-full p-2 pl-1 pr-1 max-md:h-auto max-md:min-h-[calc(100dvh-3.5rem)] max-md:!w-full max-md:!min-w-0 ${
                        isResizing ? 'transition-none' : 'transition-all duration-300 ease-in-out'
                      }`}
                      style={{
                        width: isRightCollapsed
                          ? '100%'
                          : `${String((1 - asidePanelRatio) * 100)}%`,
                        minWidth: 280,
                      }}
                      innerClassName={
                        isTabbedMain
                          ? // Tabbed views own their card; strip the shared frame
                            // (border/bg/shadow/padding) so tabs protrude above it.
                            'overflow-hidden border-0 bg-transparent p-0 shadow-none'
                          : 'overflow-y-auto scrollbar-none p-4'
                      }
                    >
                      <div className="mx-0 flex min-h-0 w-full max-w-none flex-1">
                        <ViewRouter />
                      </div>
                    </InsetCard>

                    {!isRightCollapsed && (
                      <div
                        className="group relative hidden w-2 shrink-0 cursor-col-resize items-center justify-center md:flex"
                        aria-label="Resize right panel"
                        {...rightPanelSplitterProps}
                      >
                        <div
                          className={`pointer-events-none h-10 w-1 rounded-full transition-colors ${
                            isResizing ? 'bg-gray-500' : 'bg-gray-300 group-hover:bg-gray-500'
                          }`}
                        />
                      </div>
                    )}

                    <aside
                      ref={asideRef}
                      className={`relative flex h-full flex-col bg-transparent ${isResizing ? 'transition-none' : 'transition-all duration-300 ease-in-out'} ${
                        isRightCollapsed
                          ? 'min-w-0 w-0 overflow-visible flex-none'
                          : 'min-w-[320px] overflow-hidden max-md:h-[70dvh] max-md:!w-full max-md:!min-w-0 max-md:flex-none'
                      }`}
                      style={
                        isRightCollapsed
                          ? { width: '0px' }
                          : { width: `${String(asidePanelRatio * 100)}%` }
                      }
                    >
                      <ErrorBoundary>
                        <Suspense
                          fallback={
                            <div className="text-muted-foreground flex h-full items-center justify-center bg-white text-sm">
                              Loading workspace view…
                            </div>
                          }
                        >
                          <WorkspaceView
                            collapsed={isRightCollapsed}
                            onToggleCollapse={toggleRightPanel}
                          />
                        </Suspense>
                      </ErrorBoundary>
                    </aside>
                  </div>
                </div>
              </SidebarInset>
            </div>
          </SidebarProvider>
        </ErrorBoundary>
      </WorkspaceProvider>
    </QueryProvider>
  );
}
