import React from 'react';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspaceTaskStream } from '@/hooks/useWorkspaceTaskStream';
import { useAuth } from '@/hooks/useAuth';
import { filesApi } from '@/api/files';
import { workspacesApi } from '@/api/workspaces';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { tutorialIndexTarget } from '@/tutorials/tutorialRegistry';
import { useQuotationEngineDialogStore } from '@/stores/quotationEngineStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DataFolderDialog } from '@/components/dialogs/DataFolderDialog';
import SidebarNodesSection from '@/components/layout/sidebar/SidebarNodesSection';
import SidebarTasksSection from '@/components/layout/sidebar/SidebarTasksSection';
import HelpIcon from '@/components/help/HelpIcon';
import type {
  SidebarTaskRecord,
  SidebarWorkspaceNode,
} from '@/components/layout/sidebar/types';
import {
  BarChart3,
  BookOpen,
  Bot,
  Circle,
  Cog,
  FileText,
  Filter,
  FolderOpen,
  type LucideIcon,
  MessageSquare,
  Puzzle,
  Quote,
  TrendingUp,
  Upload,
  ChevronDown,
  Pencil,
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
  { id: 'filter', label: 'Data Preprocessing', icon: Filter },
  { id: 'token-frequency', label: 'Token Frequency', icon: TrendingUp },
  { id: 'concordance', label: 'Concordance', icon: FileText },
  { id: 'analysis', label: 'Sequential Analysis', icon: BarChart3 },
  { id: 'topic-modeling', label: 'Topic Modeling', icon: Puzzle },
  { id: 'quotation', label: 'Quotation', icon: Quote },
  { id: 'ai-annotator', label: 'AI Annotator', icon: Bot },
  { id: 'export', label: 'Export', icon: Upload },
];

const Sidebar: React.FC = () => {
  const { currentView, visibleViews, setCurrentView, setViewVisibility, openFeedbackModal, openTutorialTarget } = useUIStore(
    useShallow(({ currentView, visibleViews, setCurrentView, setViewVisibility, openFeedbackModal, openTutorialTarget }) => ({ currentView, visibleViews, setCurrentView, setViewVisibility, openFeedbackModal, openTutorialTarget }))
  );
  const { workspaceGraph, currentWorkspaceId } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const { toggleNodeSelection } = useWorkspaceActions();
  const { getAuthHeaders, user, logout, dataFolder, isMultiUserMode } = useAuth();
  const { tasks, setTasks } = useAnalysisStore(
    useShallow((state) => ({
      tasks: state.tasks,
      setTasks: state.setTasks,
    }))
  );
  const openEngineDialog = useQuotationEngineDialogStore((state) => state.open);
  const {
    status: taskStreamStatus,
    error: taskStreamError,
    reconnect: reconnectTaskStream,
  } = useWorkspaceTaskStream(currentWorkspaceId ?? null);

  const nodes = (() => {
    const rawNodes = (workspaceGraph as { nodes?: unknown } | undefined)?.nodes;
    return Array.isArray(rawNodes) ? (rawNodes as SidebarWorkspaceNode[]) : [];
  })();

  const openQuotationEngineDialog = () => {
    setCurrentView('quotation');
    openEngineDialog();
  };

  const [isDataFolderDialogOpen, setIsDataFolderDialogOpen] = React.useState(false);

  const handleEditDataFolder = () => {
    setIsDataFolderDialogOpen(true);
  };

  const nodeCount = nodes.length;
  const isConnected = taskStreamStatus === 'open';
  const isConnecting = taskStreamStatus === 'connecting';
  const connectionError = taskStreamStatus === 'error' ? taskStreamError : null;

  const [collapsedSections, setCollapsedSections] = React.useState<Record<SectionKey, boolean>>({
    views: false,
    nodes: false,
    tasks: false,
  });
  const [sectionHeights, setSectionHeights] = React.useState<Record<SectionKey, number>>({
    views: 0.34,
    nodes: 0.33,
    tasks: 0.33,
  });
  const sectionsContainerRef = React.useRef<HTMLDivElement | null>(null);
  const sectionScrollRefs = React.useRef<Record<SectionKey, HTMLDivElement | null>>({
    views: null,
    nodes: null,
    tasks: null,
  });
  const [sectionsContainerHeight, setSectionsContainerHeight] = React.useState(0);
  const assignSectionScrollRef = (key: SectionKey, node: HTMLDivElement | null) => {
    sectionScrollRefs.current[key] = node;
  };
  const scrollSection = (key: SectionKey, deltaPixels: number) => {
    if (deltaPixels === 0) {
      return;
    }
    const target = sectionScrollRefs.current[key];
    if (!target) {
      return;
    }
    target.scrollTop += deltaPixels;
  };

  React.useLayoutEffect(() => {
    const container = sectionsContainerRef.current;
    if (!container) return;
    if (typeof ResizeObserver === 'undefined') {
      setSectionsContainerHeight(container.getBoundingClientRect().height);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSectionsContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const activeSectionTotal = (() => {
    const total = SECTION_KEYS.reduce((sum, key) => {
      if (collapsedSections[key]) {
        return sum;
      }
      return sum + (sectionHeights[key] ?? 0);
    }, 0);
    return total || 1;
  })();

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

  const getSectionFlexStyle = (key: SectionKey) => {
    if (collapsedSections[key]) {
      return { flex: '0 0 auto' } as React.CSSProperties;
    }
    const ratio = (sectionHeights[key] ?? 0) / activeSectionTotal;
    return { flexGrow: ratio, flexShrink: 0, flexBasis: 0 } as React.CSSProperties;
  };

  const toggleSection = (key: SectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleResizeStart = (upperKey: SectionKey, lowerKey: SectionKey, event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (collapsedSections[upperKey] || collapsedSections[lowerKey]) return;
    const containerHeight = sectionsContainerHeight || 1;
    if (containerHeight <= 0) return;

    event.preventDefault();
    const startY = event.clientY;
    const startUpper = sectionHeights[upperKey] ?? 0;
    const startLower = sectionHeights[lowerKey] ?? 0;
    const pairTotal = startUpper + startLower;
    if (pairTotal <= 0) {
      return;
    }

    const rawMinRatio = MIN_SECTION_HEIGHT / containerHeight;
    const safeMinCandidate = Math.min(Math.max(rawMinRatio, 0.02), pairTotal / 2 - 0.01);
    if (!Number.isFinite(safeMinCandidate) || safeMinCandidate <= 0 || pairTotal - safeMinCandidate <= safeMinCandidate) {
      return;
    }

    const minUpper = safeMinCandidate;
    const maxUpper = pairTotal - safeMinCandidate;

    const onMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaRatio = deltaY / containerHeight;
      const candidateUpper = startUpper + deltaRatio;
      let nextUpper = candidateUpper;
      let overflowTarget: SectionKey | null = null;
      let overflowRatio = 0;

      if (candidateUpper < minUpper) {
        nextUpper = minUpper;
        overflowTarget = upperKey;
        overflowRatio = candidateUpper - minUpper;
      } else if (candidateUpper > maxUpper) {
        nextUpper = maxUpper;
        overflowTarget = lowerKey;
        overflowRatio = candidateUpper - maxUpper;
      }

      const nextLower = pairTotal - nextUpper;
      setSectionHeights((prev) => ({
        ...prev,
        [upperKey]: nextUpper,
        [lowerKey]: nextLower,
      }));

      if (overflowTarget && overflowRatio !== 0) {
        scrollSection(overflowTarget, overflowRatio * containerHeight);
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const renderViewsBody = () => (
    <SidebarMenu>
      {visibleNavItems.map(({ id, label, icon: Icon }) => {
        const isQuotation = id === 'quotation';
        const isDisabled = !isWorkspaceLoaded && id !== 'data-loader';
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
  const handleClearTask = async (task: SidebarTaskRecord) => {
    try {
      const taskType = String(task.task_type ?? '');
      const isFileImportTask = taskType === 'ldaca_import';
      if (isFileImportTask) {
        await filesApi.clearTasks({ task_id: task.task_id }, getAuthHeaders());
      } else {
        await workspacesApi.clearTasks({ task_id: task.task_id }, getAuthHeaders());
      }
      setTasks((prev) => prev.filter((item) => item.task_id !== task.task_id));
    } catch (error) {
      console.error('Failed to clear task', error);
    }
  };

  return (
    <SidebarRoot
      className="md:p-2! md:pr-0! **:data-[sidebar=sidebar]:rounded-xl **:data-[sidebar=sidebar]:border **:data-[sidebar=sidebar]:border-border/60 **:data-[sidebar=sidebar]:shadow-sm **:data-[sidebar=sidebar]:overflow-hidden"
    >
      <SidebarHeader className="border-b border-border/40 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-2 w-full">
          <div className="flex items-center gap-2 w-full">
            <SidebarTrigger className="md:hidden" />
            <img src={logo} alt="LDaCA Logo" className="w-full h-auto object-contain" />
          </div>
          <p className="text-xl font-semibold w-full">Text Analytics</p>
          {isMultiUserMode && (
            <div className="flex items-center justify-between w-full">
              <p className="text-[11px] text-muted-foreground truncate" title={user?.name ?? 'Guest'}>
                Welcome, {user?.name ?? 'Guest'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-red-600 hover:text-red-700 shrink-0 h-auto py-0 px-1"
                onClick={logout}
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
            const isCollapsed = collapsedSections[key];
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
                      aria-expanded={!isCollapsed}
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
                            isCollapsed ? '-rotate-90' : 'rotate-0'
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
                        </DropdownMenuContent>
                      </DropdownMenu>
                      </div>
                    )}
                  </div>
                </div>
                <div
                  className={cn(
                    'flex-1 overflow-hidden transition-[max-height] duration-200',
                    isCollapsed ? 'max-h-0' : 'max-h-full'
                  )}
                >
                  {!isCollapsed && (
                    <div className="flex h-full flex-col overflow-hidden">
                      <div
                        ref={(node) => assignSectionScrollRef(key, node)}
                        className="flex h-full min-h-0 flex-col overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-2 py-2 text-sm"
                      >
                        {key === 'views' && renderViewsBody()}
                        {key === 'nodes' && (
                          <SidebarNodesSection
                            nodes={nodes}
                            selectedNodeIds={selectedNodeIds}
                            onToggleNodeSelection={toggleNodeSelection}
                          />
                        )}
                        {key === 'tasks' && (
                          <SidebarTasksSection
                            tasks={tasks}
                            isConnected={isConnected}
                            isConnecting={isConnecting}
                            connectionError={connectionError}
                            onReconnect={reconnectTaskStream}
                            onClearTask={handleClearTask}
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
