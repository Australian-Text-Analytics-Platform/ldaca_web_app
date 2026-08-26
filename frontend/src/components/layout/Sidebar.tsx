import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceTaskInbox } from '@/features/workspace/task-stream/useWorkspaceTaskInbox';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useUIStore } from '@/stores';
import { tutorialIndexTarget } from '@/tutorials/documentationRegistry';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import SidebarTasksSection from '@/components/layout/sidebar/SidebarTasksSection';
import WorkspaceNodeList from '@/components/layout/WorkspaceNodeList';
import { NodeActionsToolbar, NodePinButton } from '@/components/layout/NodeActionsToolbar';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import {
  type NodeInputPointerPosition,
  useNodeInputRequestsStore,
} from '@/stores/nodeInputRequestsStore';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import { usePinnedNodesStore } from '@/stores/pinnedNodesStore';
import type { WorkspaceGraphNode } from '@/api';
import { useStackedSplits } from '@/components/layout/sidebar/useStackedSplits';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import ReferenceIcon from '@/components/help/ReferenceIcon';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleOff,
  Cog,
  MessageSquare,
  Pencil,
} from 'lucide-react';
import { VIEW_DEFINITIONS, isWorkspaceRequired } from '@/features/views/viewRegistry';
import type { ViewType } from '@/features/views/viewIds';
import { useVisibleViews } from '@/features/views/useVisibleViews';
import {
  useUpdateUserPreferences,
  useUserPreferences,
} from '@/features/preferences/useUserPreferences';
import logo from '@/logo.png';
import { ResizeHandle } from '@/components/layout/ResizeHandle';

const SettingsDialog = React.lazy(() =>
  import('@/components/dialogs/SettingsDialog').then(({ SettingsDialog }) => ({
    default: SettingsDialog,
  })),
);

type SectionKey = 'views' | 'nodes' | 'tasks';

/** Ordered sidebar section ids consumed by `useStackedSplits` and rendering loops. */
const SECTION_KEYS: SectionKey[] = ['views', 'nodes', 'tasks'];
/** Human labels for collapsible sidebar sections shown in the section headers. */
const SECTION_TITLES: Record<SectionKey, string> = {
  views: 'Views',
  nodes: 'Data Blocks',
  tasks: 'Tasks',
};
/** Help target ids paired with sidebar section headers for contextual docs. */
const SECTION_HELP_KEYS: Record<SectionKey, string> = {
  views: 'ui.tool-choice',
  nodes: 'ui.data-selection',
  tasks: 'ui.task-centre',
};
/** Minimum sidebar section height passed to the stacked split resize hook. */
const MIN_SECTION_HEIGHT = 120;
/** Initial task section share sized for roughly two compact task rows. */
const TASKS_SECTION_DEFAULT_RATIO = 0.18;
/** Task section minimum sized for one compact task row plus its section header. */
const TASKS_SECTION_MIN_HEIGHT = 76;
/** Initial section ratios keep Tasks compact while preserving space for navigation and data blocks. */
const INITIAL_SECTION_RATIOS: Record<SectionKey, number> = {
  views: (1 - TASKS_SECTION_DEFAULT_RATIO) / 2,
  nodes: (1 - TASKS_SECTION_DEFAULT_RATIO) / 2,
  tasks: TASKS_SECTION_DEFAULT_RATIO,
};
/** Per-section minimum heights let the compact task stream shrink independently of larger sections. */
const SECTION_MIN_HEIGHTS: Partial<Record<SectionKey, number>> = {
  tasks: TASKS_SECTION_MIN_HEIGHT,
};

/**
 * Main app sidebar used by the workspace shell. It coordinates view navigation,
 * data-block selection, task stream status, help links, feedback, and working
 * directory controls from the global stores and workspace hooks.
 * Why: navigation, data selection, task status, feedback, and working-directory actions need one persistent shell surface.
 * Flow: select global/workspace/task state, wire logout/settings/dialog handlers, compute split sections and visible nav items, then render sidebar chrome.
 */
function Sidebar() {
  const { currentView, setCurrentView, openDocument, openFeedback } = useUIStore(
    useShallow(({ currentView, setCurrentView, openDocument, openFeedback }) => ({
      currentView,
      setCurrentView,
      openDocument,
      openFeedback,
    })),
  );
  const visibleViews = useVisibleViews();
  const { preferences } = useUserPreferences();
  const updatePreferences = useUpdateUserPreferences();
  const setViewHidden = (view: ViewType, hidden: boolean) => {
    const hiddenViews = new Set(preferences.hidden_views ?? []);
    if (hidden) hiddenViews.add(view);
    else hiddenViews.delete(view);
    updatePreferences.mutate({ hidden_views: [...hiddenViews] });
  };
  const { currentWorkspaceId } = useWorkspaceData();
  const { user, logout, isMultiUserMode } = useAuth();
  const queryClient = useQueryClient();
  /** Called by: the Sidebar footer/header Logout button onClick prop. */
  const handleLogout = async () => {
    // Drop all cached query data so the next signed-in user never sees the
    // previous user's files, workspaces, nodes, or preferences.
    queryClient.clear();
    await logout();
  };
  const {
    tasks,
    status: taskStreamStatus,
    error: taskStreamError,
    reconnect: reconnectTaskStream,
    stopUserFileImport,
    clearUserFileImport,
    stoppingImportId,
    clearingImportId,
  } = useWorkspaceTaskInbox(currentWorkspaceId);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = React.useState(false);

  const { workspaceGraph } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const { toggleNode, clearSelection, deleteNode, copyNode, renameNode } = useWorkspaceActions();
  const requestNodeInputAdd = useNodeInputRequestsStore((state) => state.requestAdd);
  const pinnedNodeIds = usePinnedNodesStore((state) => state.pinnedNodeIds);
  const togglePinnedNode = usePinnedNodesStore((state) => state.togglePinnedNode);

  // eslint-disable-next-line @typescript-eslint/unbound-method -- zustand action is bound to the store and does not rely on `this`
  const markInteracted = useFreshNodesStore((state) => state.markInteracted);

  const nodes = workspaceGraph?.nodes ?? [];
  const nodeCount = nodes.length;
  const selectedCount = selectedNodeIds.length;
  const pinnedIdSet = new Set(pinnedNodeIds);

  const getToolbarNode = (node: WorkspaceGraphNode) => ({
    id: node.id,
    name: node.name,
  });

  /**
   * Queues a data-block add request for the view that is active at click time.
   * Called by: NodeActionsToolbar in the Data Blocks sidebar section. The graph
   * path uses the same live-read pattern because add requests are scoped to the
   * active analysis view, and stale closures can otherwise tag a click for the
   * previous tool so no mounted selector consumes it.
   */
  const handleAddToSelection = (nodeId: string, pointer?: NodeInputPointerPosition) => {
    requestNodeInputAdd(currentWorkspaceId, useUIStore.getState().currentView, nodeId, pointer);
    if (currentWorkspaceId) markInteracted(currentWorkspaceId, [nodeId]);
  };

  const isConnected = taskStreamStatus === 'open';
  const isConnecting = taskStreamStatus === 'connecting';
  const connectionError = taskStreamStatus === 'error' ? taskStreamError : null;

  const {
    containerRef: sectionsContainerRef,
    isCollapsed,
    toggleSection,
    getSectionFlexStyle,
    assignSectionScrollRef,
    resizingLowerKey,
    handleResizeStart,
  } = useStackedSplits<SectionKey>(SECTION_KEYS, {
    minSectionPx: MIN_SECTION_HEIGHT,
    sectionMinPx: SECTION_MIN_HEIGHTS,
    initialRatios: INITIAL_SECTION_RATIOS,
  });

  const isWorkspaceLoaded = Boolean(currentWorkspaceId);
  const visibleNavItems = VIEW_DEFINITIONS.filter(({ id }) => visibleViews.includes(id));

  /**
   * Called by: Sidebar's Views section body renderer.
   * Flow: map visible views to sidebar buttons and disable workspace-only views until a workspace loads.
   */
  const renderViewsBody = () => (
    <SidebarMenu>
      {visibleNavItems.map(({ id, label, icon: Icon }) => {
        const isDisabled = !isWorkspaceLoaded && isWorkspaceRequired(id);
        return (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton
              isActive={currentView === id}
              onClick={() => {
                if (isDisabled) return;
                setCurrentView(id);
              }}
              disabled={isDisabled}
              aria-disabled={isDisabled}
              tooltip={isDisabled ? 'Load a workspace to use this view' : undefined}
            >
              <Icon />
              <span>{label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
  return (
    <SidebarRoot
      data-testid="sidebar-container"
      className="@container/sidebar pr-0! [&_[data-slot=sidebar-inner]]:overflow-hidden [&_[data-slot=sidebar-inner]]:rounded-lg [&_[data-slot=sidebar-inner]]:border [&_[data-slot=sidebar-inner]]:border-sidebar-border [&_[data-slot=sidebar-inner]]:bg-sidebar"
    >
      <div className="flex h-full min-h-0 w-full flex-col">
        <SidebarHeader data-testid="sidebar-title" className="shrink-0 overflow-hidden px-3 py-2">
          <div className="flex min-w-0 flex-col gap-2 w-full">
            <div className="flex items-center gap-2 w-full">
              <SidebarTrigger className="md:hidden" />
              <img src={logo} alt="LDaCA Logo" className="w-full h-auto object-contain" />
            </div>
            <div className="flex items-center w-full">
              <p className="text-heading-2 font-semibold flex-1">Wordflow</p>
              <InfoIcon
                targetKey="general.overview"
                label="About Wordflow"
                className="h-5 w-5 text-link"
              />
              <ReferenceIcon
                targetKey="general.platform"
                label="Cite LDaCA Wordflow"
                className="h-5 w-5 text-[var(--vscode-charts-green)]"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-description"
                    aria-label="Open settings"
                    onClick={() => {
                      setIsSettingsDialogOpen(true);
                    }}
                  >
                    <Cog className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Settings</TooltipContent>
              </Tooltip>
            </div>
            {isMultiUserMode && (
              <div className="flex items-center justify-between w-full">
                <p className="text-[11px] text-description truncate" title={user?.name ?? 'Guest'}>
                  Welcome, {user?.name ?? 'Guest'}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-label-secondary text-error hover:text-error shrink-0 h-auto py-0 px-1"
                  onClick={() => {
                    void handleLogout();
                  }}
                >
                  Logout
                </Button>
              </div>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent className="flex-1 overflow-hidden border-y border-surface-border/60">
          <div ref={sectionsContainerRef} className="flex h-full flex-col overflow-hidden">
            {SECTION_KEYS.map((key, index) => {
              const title = SECTION_TITLES[key];
              const collapsed = isCollapsed(key);
              const previousKey = SECTION_KEYS[index - 1];
              const resizeDisabled = previousKey ? isCollapsed(previousKey) || collapsed : true;
              const TwistieIcon = collapsed ? ChevronRight : ChevronDown;
              return (
                <div
                  key={key}
                  className={cn(
                    'relative flex min-h-0 flex-col',
                    index > 0 && 'border-t border-surface-border/60',
                  )}
                  style={getSectionFlexStyle(key)}
                >
                  {index > 0 && previousKey ? (
                    <ResizeHandle
                      orientation="horizontal"
                      variant="line"
                      isDragging={resizingLowerKey === key}
                      disabled={resizeDisabled}
                      className="absolute -top-1 right-0 left-0 z-10"
                      aria-label={`Resize ${title}`}
                      onPointerDown={(event) => {
                        handleResizeStart(previousKey, key, event);
                      }}
                      title="Drag to resize"
                    />
                  ) : null}
                  <div
                    data-sidebar-section={key}
                    data-testid={`sidebar-section-${key}`}
                    className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  >
                    <div>
                      <div
                        data-testid={`sidebar-section-header-${key}`}
                        className="group/sidebar-section-header mx-1 flex items-center rounded-md transition-colors hover:bg-list-hover focus-within:bg-list-hover"
                      >
                        <button
                          type="button"
                          data-guidance={key === 'nodes' ? 'data-blocks' : undefined}
                          className="flex min-w-0 flex-1 items-center justify-between px-2 py-1.5 text-label-secondary font-semibold uppercase tracking-wide text-description"
                          onClick={() => {
                            toggleSection(key);
                          }}
                          aria-expanded={!collapsed}
                        >
                          <span className="flex min-w-0 items-center gap-1">
                            <TwistieIcon
                              data-testid={`sidebar-section-twistie-${key}`}
                              className="h-4 w-4 shrink-0"
                              aria-hidden="true"
                            />
                            <span>{title}</span>
                          </span>
                          {key === 'tasks' && (
                            <div className="flex items-center gap-2 text-[11px] text-description">
                              <Circle
                                data-testid="tasks-connection-indicator"
                                className={cn('h-3 w-3', {
                                  'fill-[var(--vscode-charts-green)] text-[var(--vscode-charts-green)]':
                                    isConnected,
                                  'text-warning fill-warning animate-pulse': isConnecting,
                                  'text-description fill-description':
                                    !isConnected && !isConnecting && !connectionError,
                                  'fill-error text-error': !!connectionError,
                                })}
                              />
                            </div>
                          )}
                        </button>
                        {key === 'nodes' && (
                          <div className="flex items-center gap-2 text-[11px] text-description">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-description"
                                  aria-label="Clear selection"
                                  disabled={selectedCount === 0}
                                  onClick={clearSelection}
                                >
                                  <CircleOff
                                    data-testid="clear-selection-icon"
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="right">Clear</TooltipContent>
                            </Tooltip>
                            <span className="font-semibold text-foreground/80">
                              {selectedCount > 0
                                ? `${selectedCount.toString()}/${nodeCount.toString()}`
                                : nodeCount.toString()}
                            </span>
                          </div>
                        )}
                        <HelpIcon
                          targetKey={SECTION_HELP_KEYS[key]}
                          label={title}
                          className="h-5 w-5 shrink-0 text-description"
                        />
                        {key === 'views' && (
                          <div className="pr-1.5">
                            <DropdownMenu>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-description"
                                      aria-label="Edit visible views"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent side="right">Edit visible views</TooltipContent>
                              </Tooltip>
                              <DropdownMenuContent align="end" className="w-56">
                                {VIEW_DEFINITIONS.filter(
                                  ({ requiresWorkspace }) => requiresWorkspace,
                                ).map(({ id, label }) => {
                                  const checked = visibleViews.includes(id);
                                  return (
                                    <DropdownMenuCheckboxItem
                                      key={id}
                                      checked={checked}
                                      onSelect={(event) => {
                                        event.preventDefault();
                                        setViewHidden(id, checked);
                                      }}
                                    >
                                      {label}
                                    </DropdownMenuCheckboxItem>
                                  );
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </div>
                    </div>
                    <div
                      className={cn(
                        'flex-1 overflow-hidden transition-[max-height] duration-200',
                        collapsed ? 'max-h-0' : 'max-h-full',
                      )}
                    >
                      {!collapsed && (
                        <div className="flex h-full flex-col overflow-hidden">
                          <div
                            ref={(node) => {
                              assignSectionScrollRef(key, node);
                            }}
                            className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-none px-2 py-2 text-body"
                          >
                            {key === 'views' && renderViewsBody()}
                            {key === 'nodes' && (
                              <WorkspaceNodeList
                                workspaceId={currentWorkspaceId}
                                nodes={nodes}
                                selectedNodeIds={selectedNodeIds}
                                onToggleNodeSelection={toggleNode}
                                renderPinnedRowAction={(node: WorkspaceGraphNode) => (
                                  <NodePinButton
                                    node={getToolbarNode(node)}
                                    isPinned={pinnedIdSet.has(node.id)}
                                    onTogglePin={togglePinnedNode}
                                  />
                                )}
                                renderRowActions={(node: WorkspaceGraphNode) => (
                                  <NodeActionsToolbar
                                    node={getToolbarNode(node)}
                                    isPinned={pinnedIdSet.has(node.id)}
                                    onTogglePin={togglePinnedNode}
                                    onAddToSelection={handleAddToSelection}
                                    onRename={(id, newName) => {
                                      void renameNode(id, newName);
                                    }}
                                    onClone={(id) => {
                                      void copyNode(id);
                                    }}
                                    onDelete={(id) => {
                                      void deleteNode(id);
                                    }}
                                  />
                                )}
                              />
                            )}
                            {key === 'tasks' && (
                              <SidebarTasksSection
                                tasks={tasks}
                                isConnected={isConnected}
                                isConnecting={isConnecting}
                                connectionError={connectionError}
                                onReconnect={reconnectTaskStream}
                                onStopUserFileImport={stopUserFileImport}
                                onClearUserFileImport={clearUserFileImport}
                                stoppingImportId={stoppingImportId}
                                clearingImportId={clearingImportId}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SidebarContent>

        <SidebarFooter
          data-testid="sidebar-help-feedback"
          className="shrink-0 space-y-2 overflow-hidden px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <div className="flex flex-1 flex-col gap-2 @min-[208px]/sidebar:flex-row">
              <Button
                variant="ghost"
                className="flex-1 justify-center"
                onClick={() => {
                  openDocument(tutorialIndexTarget);
                }}
              >
                <BookOpen className="h-4 w-4" />
                <span>Help</span>
              </Button>
              <Button
                variant="ghost"
                className="flex-1 justify-center"
                onClick={() => {
                  openFeedback();
                }}
              >
                <MessageSquare className="h-4 w-4" />
                <span>Feedback</span>
              </Button>
            </div>
          </div>
        </SidebarFooter>
      </div>

      {isSettingsDialogOpen ? (
        <React.Suspense fallback={null}>
          <SettingsDialog open onOpenChange={setIsSettingsDialogOpen} />
        </React.Suspense>
      ) : null}
      <SidebarRail />
    </SidebarRoot>
  );
}

export default Sidebar;
