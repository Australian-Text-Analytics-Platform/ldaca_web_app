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
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { tutorialIndexTarget } from '@/tutorials/tutorialRegistry';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SettingsDialog } from '@/components/dialogs/SettingsDialog';
import SidebarTasksSection from '@/components/layout/sidebar/SidebarTasksSection';
import WorkspaceNodeList from '@/components/layout/WorkspaceNodeList';
import { NodeActionsToolbar, NodePinButton } from '@/components/layout/NodeActionsToolbar';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import { usePinnedNodesStore } from '@/stores/pinnedNodesStore';
import type { SidebarWorkspaceNode } from '@/components/layout/sidebar/types';
import { useStackedSplits } from '@/components/layout/sidebar/useStackedSplits';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import ReferenceIcon from '@/components/help/ReferenceIcon';
import {
  BookOpen,
  Circle,
  Cog,
  FileText,
  Filter,
  FolderOpen,
  Hash,
  type LucideIcon,
  MessageSquare,
  Puzzle,
  Quote,
  TrendingUp,
  Upload,
  ChevronDown,
  Pencil,
  Tags,
} from 'lucide-react';
import type { ViewType } from '@/stores';
import logo from '@/logo.png';

interface NavItem {
  id: ViewType;
  label: string;
  icon: LucideIcon;
}

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

/** Navigation items rendered in the Views sidebar section and routed by `ViewRouter`. */
const NAV_ITEMS: NavItem[] = [
  { id: 'data-loader', label: 'Data Loader', icon: FolderOpen },
  { id: 'filter', label: 'Preprocessing', icon: Filter },
  { id: 'token-frequency', label: 'Frequency', icon: Hash },
  { id: 'concordance', label: 'Concordance', icon: FileText },
  { id: 'analysis', label: 'Trends', icon: TrendingUp },
  { id: 'topic-modeling', label: 'Topic Modeling', icon: Puzzle },
  { id: 'quotation', label: 'Quotation', icon: Quote },
  { id: 'annotation', label: 'Annotation', icon: Tags },
  { id: 'export', label: 'Export', icon: Upload },
];

/**
 * Main app sidebar used by the workspace shell. It coordinates view navigation,
 * data-block selection, task stream status, help links, feedback, and working
 * directory controls from the global stores and workspace hooks.
 * Why: navigation, data selection, task status, feedback, and working-directory actions need one persistent shell surface.
 * Flow: select global/workspace/task state, wire logout/settings/dialog handlers, compute split sections and visible nav items, then render sidebar chrome.
 */
function Sidebar() {
  const { currentView, visibleViews, setCurrentView, setViewVisibility, openModal } = useUIStore(
    useShallow(({ currentView, visibleViews, setCurrentView, setViewVisibility, openModal }) => ({
      currentView,
      visibleViews,
      setCurrentView,
      setViewVisibility,
      openModal,
    })),
  );
  const { currentWorkspaceId } = useWorkspaceData();
  const { user, logout, isMultiUserMode } = useAuth();
  const queryClient = useQueryClient();
  /** Called by: the Sidebar footer/header Logout button onClick prop because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handleLogout = async () => {
    // Drop all cached query data so the next signed-in user never sees the
    // previous user's files, workspaces, nodes, or preferences.
    queryClient.clear();
    await logout();
  };
  const tasks = useAnalysisStore((state) => state.tasks);
  const {
    status: taskStreamStatus,
    error: taskStreamError,
    reconnect: reconnectTaskStream,
  } = useWorkspaceTaskInbox(currentWorkspaceId);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = React.useState(false);

  const { workspaceGraph } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const {
    toggleNodeSelection,
    deleteNode,
    copyNode,
    renameNode,
    undoNode,
    redoNode,
  } = useWorkspaceActions();
  const requestNodeInputAdd = useNodeInputRequestsStore((state) => state.requestAdd);
  const pinnedNodeIds = usePinnedNodesStore((state) => state.pinnedNodeIds);
  const togglePinnedNode = usePinnedNodesStore((state) => state.togglePinnedNode);

  // eslint-disable-next-line @typescript-eslint/unbound-method -- zustand action is bound to the store and does not rely on `this`
  const markInteracted = useFreshNodesStore((state) => state.markInteracted);

  const rawNodes = workspaceGraph?.nodes;
  const nodes = Array.isArray(rawNodes) ? (rawNodes as SidebarWorkspaceNode[]) : [];
  const nodeCount = nodes.length;
  const selectedCount = selectedNodeIds.length;
  const pinnedIdSet = new Set(pinnedNodeIds);

  const getToolbarNode = (node: SidebarWorkspaceNode) => ({
    id: node.id,
    name: node.name ?? node.label ?? node.id,
    canUndo: node.can_undo,
    canRedo: node.can_redo,
  });

  /**
   * Queues a data-block add request for the view that is active at click time.
   * Called by: NodeActionsToolbar in the Data Blocks sidebar section. The graph
   * path uses the same live-read pattern because add requests are scoped to the
   * active analysis view, and stale closures can otherwise tag a click for the
   * previous tool so no mounted selector consumes it.
   */
  const handleAddToSelection = (nodeId: string) => {
    requestNodeInputAdd(currentWorkspaceId, useUIStore.getState().currentView, nodeId);
    markInteracted([nodeId]);
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
    handleResizeStart,
  } = useStackedSplits<SectionKey>(SECTION_KEYS, {
    minSectionPx: MIN_SECTION_HEIGHT,
    sectionMinPx: SECTION_MIN_HEIGHTS,
    initialRatios: INITIAL_SECTION_RATIOS,
  });

  const isWorkspaceLoaded = Boolean(currentWorkspaceId);
  const visibleNavItems = NAV_ITEMS.filter(({ id }) => visibleViews.includes(id));

  /**
   * Called by: Sidebar's Views section body renderer because the caller needs a focused rendering boundary for layout, accessibility, and state handoff steps.
   * Flow: map visible views to sidebar buttons and disable workspace-only views until a workspace loads.
   */
  const renderViewsBody = () => (
    <SidebarMenu>
      {visibleNavItems.map(({ id, label, icon: Icon }) => {
        const isDisabled = !isWorkspaceLoaded && id !== 'data-loader';
        return (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton
              isActive={currentView === id}
              data-hint-id={id === 'data-loader' ? 'sidebar.data-loader' : undefined}
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
    <SidebarRoot className="md:p-2! md:pr-1! **:data-[sidebar=sidebar]:rounded-xl **:data-[sidebar=sidebar]:border **:data-[sidebar=sidebar]:border-border/60 **:data-[sidebar=sidebar]:shadow-sm **:data-[sidebar=sidebar]:overflow-hidden">
      <SidebarHeader className="px-3 py-2">
        <div className="flex min-w-0 flex-col gap-2 w-full">
          <div className="flex items-center gap-2 w-full">
            <SidebarTrigger className="md:hidden" />
            <img src={logo} alt="LDaCA Logo" className="w-full h-auto object-contain" />
          </div>
          <div className="flex items-center w-full">
            <p className="text-xl font-semibold flex-1">Wordflow</p>
            <InfoIcon
              targetKey="general.overview"
              label="About Wordflow"
              className="h-5 w-5 text-blue-500"
            />
            <ReferenceIcon
              targetKey="general.platform"
              label="Cite LDaCA Wordflow"
              className="h-5 w-5 text-emerald-600"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
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
              <p
                className="text-[11px] text-muted-foreground truncate"
                title={user?.name ?? 'Guest'}
              >
                Welcome, {user?.name ?? 'Guest'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-red-600 hover:text-red-700 shrink-0 h-auto py-0 px-1"
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
      <SidebarContent className="flex-1 overflow-hidden">
        <div ref={sectionsContainerRef} className="flex h-full flex-col gap-2 overflow-hidden">
          {SECTION_KEYS.map((key, index) => {
            const title = SECTION_TITLES[key];
            const collapsed = isCollapsed(key);
            const previousKey = SECTION_KEYS[index - 1];
            return (
              <div
                key={key}
                className="flex min-h-0 flex-col rounded-md border border-border/40 bg-background/40"
                style={getSectionFlexStyle(key)}
              >
                <div className="relative">
                  {index > 0 && previousKey ? (
                    <div
                      className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize"
                      role="separator"
                      aria-label={`Resize ${title}`}
                      onMouseDown={(event) => {
                        handleResizeStart(previousKey, key, event);
                      }}
                    />
                  ) : null}
                  <div className="flex items-center border-b border-border/40 bg-muted/40">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      onClick={() => {
                        toggleSection(key);
                      }}
                      aria-expanded={!collapsed}
                    >
                      <span className="flex items-center gap-1">{title}</span>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {key === 'nodes' && (
                          <span className="font-semibold text-foreground/80">
                            {selectedCount > 0
                              ? `${selectedCount.toString()}/${nodeCount.toString()}`
                              : nodeCount.toString()}
                          </span>
                        )}
                        {key === 'tasks' && (
                          <Circle
                            data-testid="tasks-connection-indicator"
                            className={cn('h-3 w-3', {
                              'text-green-500 fill-green-500': isConnected,
                              'text-amber-500 fill-amber-500 animate-pulse': isConnecting,
                              'text-muted-foreground fill-muted-foreground':
                                !isConnected && !isConnecting && !connectionError,
                              'text-red-500 fill-red-500': !!connectionError,
                            })}
                          />
                        )}
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 transition-transform',
                            collapsed ? '-rotate-90' : 'rotate-0',
                          )}
                        />
                      </div>
                    </button>
                    <HelpIcon
                      targetKey={SECTION_HELP_KEYS[key]}
                      label={title}
                      className="h-5 w-5 shrink-0 text-muted-foreground"
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
                                  className="h-6 w-6 text-muted-foreground"
                                  aria-label="Edit visible views"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="right">Edit visible views</TooltipContent>
                          </Tooltip>
                          <DropdownMenuContent align="end" className="w-56">
                            {NAV_ITEMS.filter(({ id }) => id !== 'data-loader').map(
                              ({ id, label }) => {
                                const checked = visibleViews.includes(id);
                                const isLastVisibleItem = checked && visibleViews.length === 1;
                                return (
                                  <DropdownMenuCheckboxItem
                                    key={id}
                                    checked={checked}
                                    disabled={isLastVisibleItem}
                                    onSelect={(event) => {
                                      event.preventDefault();
                                      setViewVisibility(id, !checked);
                                    }}
                                  >
                                    {label}
                                  </DropdownMenuCheckboxItem>
                                );
                              },
                            )}
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
                        className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-none px-2 py-2 text-sm"
                      >
                        {key === 'views' && renderViewsBody()}
                        {key === 'nodes' && (
                          <WorkspaceNodeList
                            nodes={nodes}
                            selectedNodeIds={selectedNodeIds}
                            onToggleNodeSelection={toggleNodeSelection}
                            renderPinnedRowAction={(node: SidebarWorkspaceNode) => (
                              <NodePinButton
                                node={getToolbarNode(node)}
                                isPinned={pinnedIdSet.has(node.id)}
                                onTogglePin={togglePinnedNode}
                              />
                            )}
                            renderRowActions={(node: SidebarWorkspaceNode) => (
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
                                onUndo={(id) => {
                                  void undoNode(id);
                                }}
                                onRedo={(id) => {
                                  void redoNode(id);
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
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SidebarContent>

      <SidebarFooter className="space-y-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-2">
            <Button
              variant="ghost"
              className="flex-1 justify-center"
              onClick={() => {
                openModal('tutorial', tutorialIndexTarget);
              }}
            >
              <BookOpen className="h-4 w-4" />
              <span>Tutorial</span>
            </Button>
            <Button
              variant="ghost"
              className="flex-1 justify-center"
              onClick={() => {
                openModal('feedback');
              }}
            >
              <MessageSquare className="h-4 w-4" />
              <span>Feedback</span>
            </Button>
          </div>
        </div>
      </SidebarFooter>

      <SettingsDialog open={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen} />
      <SidebarRail />
    </SidebarRoot>
  );
}

export default Sidebar;
