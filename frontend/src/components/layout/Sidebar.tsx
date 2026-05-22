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
  SidebarMenuAction,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceTaskInbox } from '@/features/workspace/task-stream/useWorkspaceTaskInbox';
import { useAuth } from '@/hooks/useAuth';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { useHintsStore } from '@/stores/hintsStore';
import { tutorialIndexTarget } from '@/tutorials/tutorialRegistry';
import { useQuotationEngineDialogStore } from '@/stores/quotationEngineStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { DataFolderDialog } from '@/components/dialogs/DataFolderDialog';
import { ClearEmbeddingCacheMenuItem } from '@/features/analysis/topic-modeling/components/ClearEmbeddingCacheMenuItem';
import { DemoSnapshotsToggleItem } from '@/features/snapshot-view/components/DemoSnapshotsToggleItem';
import SidebarNodesSection from '@/components/layout/sidebar/SidebarNodesSection';
import SidebarTasksSection from '@/components/layout/sidebar/SidebarTasksSection';
import { useStackedSplits } from '@/components/layout/sidebar/useStackedSplits';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import ReferenceIcon from '@/components/help/ReferenceIcon';
import type { SidebarWorkspaceNode } from '@/components/layout/sidebar/types';
import {
  BookOpen,
  Bot,
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
  RotateCcw,
} from 'lucide-react';
import type { ViewType } from '@/stores';
import logo from '@/logo.png';

type NavItem = {
  id: ViewType;
  label: string;
  icon: LucideIcon;
};

type SectionKey = 'views' | 'nodes' | 'tasks';

const SECTION_KEYS: SectionKey[] = ['views', 'nodes', 'tasks'];
const SECTION_TITLES: Record<SectionKey, string> = {
  views: 'Views',
  nodes: 'Data Blocks',
  tasks: 'Tasks',
};
const SECTION_HELP_KEYS: Record<SectionKey, string> = {
  views: 'ui.tool-choice',
  nodes: 'ui.data-selection',
  tasks: 'ui.task-centre',
};
const MIN_SECTION_HEIGHT = 120;

const NAV_ITEMS: NavItem[] = [
  { id: 'data-loader', label: 'Data Loader', icon: FolderOpen },
  { id: 'filter', label: 'Preprocessing', icon: Filter },
  { id: 'token-frequency', label: 'Frequency', icon: Hash },
  { id: 'concordance', label: 'Concordance', icon: FileText },
  { id: 'analysis', label: 'Trends', icon: TrendingUp },
  { id: 'topic-modeling', label: 'Topic Modeling', icon: Puzzle },
  { id: 'quotation', label: 'Quotation', icon: Quote },
  { id: 'ai-annotator', label: 'AI Annotator', icon: Bot },
  { id: 'export', label: 'Export', icon: Upload },
];

const Sidebar: React.FC = () => {
  const {
    currentView,
    visibleViews,
    setCurrentView,
    setViewVisibility,
    openFeedbackModal,
    openTutorialTarget,
    resetSessionDismissedHints,
  } = useUIStore(
    useShallow(({
      currentView,
      visibleViews,
      setCurrentView,
      setViewVisibility,
      openFeedbackModal,
      openTutorialTarget,
      resetSessionDismissedHints,
    }) => ({
      currentView,
      visibleViews,
      setCurrentView,
      setViewVisibility,
      openFeedbackModal,
      openTutorialTarget,
      resetSessionDismissedHints,
    }))
  );
  const resetHints = useHintsStore((state) => state.resetHints);
  const { workspaceGraph, currentWorkspaceId } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const { toggleNodeSelection, clearSelection } = useWorkspaceActions();
  const { user, logout, dataFolder, isMultiUserMode } = useAuth();
  const queryClient = useQueryClient();
  const handleLogout = async () => {
    // Drop all cached query data so the next signed-in user never sees the
    // previous user's files, workspaces, nodes, or preferences.
    queryClient.clear();
    await logout();
  };
  const tasks = useAnalysisStore((state) => state.tasks);
  const openEngineDialog = useQuotationEngineDialogStore((state) => state.open);
  const {
    status: taskStreamStatus,
    error: taskStreamError,
    reconnect: reconnectTaskStream,
  } = useWorkspaceTaskInbox(currentWorkspaceId ?? null);

  const rawNodes = (workspaceGraph as { nodes?: unknown } | undefined)?.nodes;
  const nodes = Array.isArray(rawNodes) ? (rawNodes as SidebarWorkspaceNode[]) : [];

  const openQuotationEngineDialog = () => {
    setCurrentView('quotation');
    openEngineDialog();
  };

  const handleResetHints = () => {
    resetHints();
    resetSessionDismissedHints();
    toast('All hints have been reset. Dismissed hints can appear again.');
  };

  const [isDataFolderDialogOpen, setIsDataFolderDialogOpen] = React.useState(false);

  const handleEditDataFolder = () => {
    setIsDataFolderDialogOpen(true);
  };

  const nodeCount = nodes.length;
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
    initialRatios: { views: 0.34, nodes: 0.33, tasks: 0.33 },
  });

  const isWorkspaceLoaded = Boolean(currentWorkspaceId);
  const visibleNavItems = NAV_ITEMS.filter(({ id }) => visibleViews.includes(id));
  const fallbackVisibleView = visibleNavItems[0]?.id ?? 'data-loader';

  React.useEffect(() => {
    if (!isWorkspaceLoaded && currentView !== 'data-loader') {
      setCurrentView('data-loader');
    }
  }, [currentView, isWorkspaceLoaded, setCurrentView]);

  React.useEffect(() => {
    if (!visibleViews.includes(currentView)) {
      setCurrentView(fallbackVisibleView);
    }
  }, [currentView, fallbackVisibleView, setCurrentView, visibleViews]);

  const renderViewsBody = () => (
    <SidebarMenu>
      {visibleNavItems.map(({ id, label, icon: Icon }) => {
        const isQuotation = id === 'quotation';
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
            {isQuotation ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuAction
                    aria-label="Configure quotation engine"
                    showOnHover
                    disabled={isDisabled}
                    aria-disabled={isDisabled}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (isDisabled) return;
                      openQuotationEngineDialog();
                    }}
                  >
                    <Cog className="h-4 w-4" />
                  </SidebarMenuAction>
                </TooltipTrigger>
                <TooltipContent side="right">Settings</TooltipContent>
              </Tooltip>
            ) : null}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
  return (
    <SidebarRoot
      className="md:p-2! md:pr-1! **:data-[sidebar=sidebar]:rounded-xl **:data-[sidebar=sidebar]:border **:data-[sidebar=sidebar]:border-border/60 **:data-[sidebar=sidebar]:shadow-sm **:data-[sidebar=sidebar]:overflow-hidden"
    >
      <SidebarHeader className="border-b border-border/40 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-2 w-full">
          <div className="flex items-center gap-2 w-full">
            <SidebarTrigger className="md:hidden" />
            <img src={logo} alt="LDaCA Logo" className="w-full h-auto object-contain" />
          </div>
              <div className="flex items-center w-full">
            <p className="text-xl font-semibold flex-1">Wordflow</p>
                <InfoIcon targetKey="general.overview" label="About Wordflow" className="h-5 w-5 text-blue-500" />
                <ReferenceIcon targetKey="general.platform" label="Cite LDaCA Wordflow" className="h-5 w-5 text-emerald-600" />
              </div>
          {isMultiUserMode && (
            <div className="flex items-center justify-between w-full">
              <p className="text-[11px] text-muted-foreground truncate" title={user?.name ?? 'Guest'}>
                Welcome, {user?.name ?? 'Guest'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-red-600 hover:text-red-700 shrink-0 h-auto py-0 px-1"
                onClick={handleLogout}
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
                      onMouseDown={(event) => handleResizeStart(previousKey, key, event)}
                    />
                  ) : null}
                  <div className="flex items-center border-b border-border/40 bg-muted/40">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      onClick={() => toggleSection(key)}
                      aria-expanded={!collapsed}
                    >
                      <span className="flex items-center gap-1">
                        {title}
                      </span>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {key === 'nodes' && (
                          <span className="font-medium text-foreground/80">{nodeCount}</span>
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
                            collapsed ? '-rotate-90' : 'rotate-0'
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
                          {NAV_ITEMS.filter(({ id }) => id !== 'data-loader').map(({ id, label }) => {
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
                          })}
                          <DropdownMenuSeparator />
                          <DemoSnapshotsToggleItem />
                          <DropdownMenuItem
                            onSelect={handleResetHints}
                            className="text-xs text-muted-foreground focus:text-foreground"
                          >
                            <RotateCcw className="mr-2 h-3.5 w-3.5" />
                            Reset all hints
                          </DropdownMenuItem>
                          <ClearEmbeddingCacheMenuItem />
                        </DropdownMenuContent>
                      </DropdownMenu>
                      </div>
                    )}
                  </div>
                </div>
                <div
                  className={cn(
                    'flex-1 overflow-hidden transition-[max-height] duration-200',
                    collapsed ? 'max-h-0' : 'max-h-full'
                  )}
                >
                  {!collapsed && (
                    <div className="flex h-full flex-col overflow-hidden">
                      <div
                        ref={(node) => assignSectionScrollRef(key, node)}
                        className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-none px-2 py-2 text-sm"
                      >
                        {key === 'views' && renderViewsBody()}
                        {key === 'nodes' && (
                          <SidebarNodesSection
                            nodes={nodes}
                            selectedNodeIds={selectedNodeIds}
                            onToggleNodeSelection={toggleNodeSelection}
                            onClearSelection={clearSelection}
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
        {!isMultiUserMode && (
          <div
            className="rounded-md border border-border/60 bg-muted/30 px-3 py-2"
            data-testid="sidebar-data-directory"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                  Working directory
                  <HelpIcon targetKey="ui.working-directory" label="Working Directory" className="h-4 w-4 text-muted-foreground" />
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground break-all">
                  {dataFolder || 'Not configured'}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    aria-label="Change working directory"
                    onClick={handleEditDataFolder}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Change working directory</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-2">
            <Button
              variant="ghost"
              className="flex-1 justify-center"
              onClick={() => openTutorialTarget(tutorialIndexTarget)}
            >
              <BookOpen className="h-4 w-4" />
              <span>Tutorial</span>
            </Button>
            <Button
              variant="ghost"
              className="flex-1 justify-center"
              onClick={openFeedbackModal}
            >
              <MessageSquare className="h-4 w-4" />
              <span>Feedback</span>
            </Button>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
      {!isMultiUserMode && (
        <DataFolderDialog
          open={isDataFolderDialogOpen}
          onOpenChange={setIsDataFolderDialogOpen}
        />
      )}
    </SidebarRoot>
  );
};

export default Sidebar;
