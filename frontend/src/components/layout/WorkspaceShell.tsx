import { Suspense, lazy } from 'react';
import { useDevicePreferencesInit } from '@/features/preferences/useUserPreferences';
import { useSidebarResize } from '@/hooks/useSidebarResize';
import { useRightPanelResize } from '@/hooks/useRightPanelResize';
import { QueryProvider } from '@/providers/QueryProvider';
import { WorkspaceProvider } from '@/features/workspace/common/WorkspaceProvider';
import { WorkspaceDownloadsProvider } from '@/features/workspace/workspace-downloads/WorkspaceDownloadsProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import Sidebar from '@/components/layout/Sidebar';
import { InsetCard } from '@/components/layout/InsetCard';
import { RefreshStatusBanner } from '@/features/auth/components/RefreshStatusBanner';
import { useUIStore } from '@/stores';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { DocumentModalHost } from '@/components/dialogs/DocumentModalHost';
import { ViewRouteSync } from '@/components/layout/ViewRouteSync';
import { ViewRouter } from '@/components/layout/ViewRouter';
import { isTabbedMainView } from '@/features/views/viewRegistry';
import { GuidanceProvider } from '@/features/guidance/GuidanceProvider';

const WorkspaceView = lazy(() => import('@/components/layout/WorkspaceView'));

export function WorkspaceShell() {
  return (
    <QueryProvider>
      <WorkspaceShellContent />
    </QueryProvider>
  );
}

function WorkspaceShellContent() {
  useDevicePreferencesInit();
  const currentView = useUIStore((s) => s.currentView);
  const isTabbedMain = isTabbedMainView(currentView);

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
    <WorkspaceProvider>
      <GuidanceProvider>
        <ViewRouteSync />
        <ErrorBoundary>
          <SidebarProvider
            className="bg-linear-to-br from-slate-50 to-blue-50"
            style={{ ['--sidebar-width' as string]: `${String(sidebarWidth)}px` }}
          >
            <DocumentModalHost />
            <RefreshStatusBanner />
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

              <SidebarInset className="@container/workspace-shell flex h-full flex-1 flex-col overflow-hidden bg-transparent md:m-0! md:ml-0! md:rounded-none! md:shadow-none!">
                <header className="border-border/40 border-b bg-white px-4 py-3 md:hidden">
                  <div className="flex items-center justify-between">
                    <SidebarTrigger />
                  </div>
                </header>

                <div className="flex flex-1 flex-col overflow-hidden">
                  {/* Stack whenever the post-sidebar shell becomes too narrow for both panes. */}
                  <div
                    className="relative flex flex-1 overflow-hidden max-md:flex-col max-md:overflow-y-auto @max-[639px]/workspace-shell:flex-col @max-[639px]/workspace-shell:overflow-y-auto"
                    ref={layoutRef}
                  >
                    <InsetCard
                      ref={mainRef}
                      role="main"
                      className={`relative h-full p-2 pl-1 pr-1 max-md:h-auto max-md:min-h-[calc(100dvh-3.5rem)] max-md:w-full! max-md:min-w-0! @max-[639px]/workspace-shell:h-auto @max-[639px]/workspace-shell:min-h-[calc(100dvh-3.5rem)] @max-[639px]/workspace-shell:w-full! @max-[639px]/workspace-shell:min-w-0! ${
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
                        <WorkspaceDownloadsProvider>
                          <ViewRouter />
                        </WorkspaceDownloadsProvider>
                      </div>
                    </InsetCard>

                    {!isRightCollapsed && (
                      <div
                        className="group relative hidden w-2 shrink-0 cursor-col-resize items-center justify-center md:flex @max-[639px]/workspace-shell:hidden"
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
                          : 'min-w-[320px] overflow-hidden max-md:h-[70dvh] max-md:w-full! max-md:min-w-0! max-md:flex-none @max-[639px]/workspace-shell:h-[70dvh] @max-[639px]/workspace-shell:w-full! @max-[639px]/workspace-shell:min-w-0! @max-[639px]/workspace-shell:flex-none'
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
      </GuidanceProvider>
    </WorkspaceProvider>
  );
}
