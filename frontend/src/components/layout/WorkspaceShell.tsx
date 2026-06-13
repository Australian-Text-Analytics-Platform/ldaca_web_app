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
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { DocumentModalHost } from '@/components/dialogs/DocumentModalHost';
import { ViewRouteSync } from '@/components/layout/ViewRouteSync';
import { ViewRouter } from '@/components/layout/ViewRouter';

const FeedbackPanel = lazy(() => import('@/features/feedback/components/FeedbackPanel'));
const WorkspaceView = lazy(() => import('@/components/layout/WorkspaceView'));
const HintsController = lazy(() => import('@/features/hints/HintsController'));

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
                  <FeedbackPanel open={feedbackOpen} onClose={() => { closeModal('feedback'); }} />
                </Suspense>

                <header className="border-border/40 border-b bg-white px-4 py-3 md:hidden">
                  <div className="flex items-center justify-between">
                    <SidebarTrigger />
                  </div>
                </header>

                <div className="flex flex-1 flex-col overflow-hidden">
                  <div className="relative flex flex-1 overflow-hidden" ref={layoutRef}>
                    <InsetCard
                      ref={mainRef}
                      role="main"
                      className={`relative h-full p-2 pl-1 ${
                        isRightCollapsed ? 'pr-2' : 'pr-1'
                      } ${isResizing ? 'transition-none' : 'transition-all duration-300 ease-in-out'}`}
                      style={{
                        width: isRightCollapsed ? '100%' : `${String((1 - asidePanelRatio) * 100)}%`,
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
                      className={`relative flex h-full flex-col overflow-hidden bg-transparent ${isResizing ? 'transition-none' : 'transition-all duration-300 ease-in-out'} ${
                        isRightCollapsed ? 'min-w-0' : 'min-w-[320px]'
                      }`}
                      style={{ width: isRightCollapsed ? 0 : `${String(asidePanelRatio * 100)}%` }}
                    >
                      {!isRightCollapsed && (
                        <button
                          onClick={toggleRightPanel}
                          className="group absolute top-2 right-2 z-20 flex items-center rounded-md border border-gray-300 bg-white/80 px-2 py-1 text-gray-700 shadow-sm backdrop-blur hover:bg-gray-50"
                          aria-label="Collapse right panel"
                          title="Collapse"
                        >
                          <span className="mr-1 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-30">
                            Collapse
                          </span>
                          <span aria-hidden>❯</span>
                        </button>
                      )}
                      <ErrorBoundary>
                        {!isRightCollapsed && (
                          <Suspense
                            fallback={
                              <div className="text-muted-foreground flex h-full items-center justify-center bg-white text-sm">
                                Loading workspace view…
                              </div>
                            }
                          >
                            <WorkspaceView />
                          </Suspense>
                        )}
                      </ErrorBoundary>
                    </aside>

                    {isRightCollapsed && (
                      <button
                        onClick={toggleRightPanel}
                        className="group absolute top-2 right-2 z-30 flex items-center rounded-md border border-gray-300 bg-white/90 px-2 py-1 text-gray-700 shadow backdrop-blur hover:bg-gray-50"
                        aria-label="Expand right panel"
                        title="Expand"
                      >
                        <span className="mr-1 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-24">
                          Show
                        </span>
                        <span aria-hidden>❮</span>
                      </button>
                    )}
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
