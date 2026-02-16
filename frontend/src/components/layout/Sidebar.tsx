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
import { cn } from '@/lib/utils';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspaceTaskStream } from '@/hooks/useWorkspaceTaskStream';
import { useAuth } from '@/hooks/useAuth';
import { workspacesApi } from '@/api/workspaces';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { tutorialIndexTarget } from '@/tutorials/tutorialRegistry';
import { useQuotationEngineDialogStore } from '@/stores/quotationEngineStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DataFolderDialog } from '@/components/dialogs/DataFolderDialog';
import SidebarNodesSection from '@/components/layout/sidebar/SidebarNodesSection';
import SidebarTasksSection from '@/components/layout/sidebar/SidebarTasksSection';
import type {
  SidebarTaskRecord,
  SidebarWorkspaceNode,
} from '@/components/layout/sidebar/types';
import {
  BarChart3,
  BookOpen,
  Circle,
  Cog,
  FileText,
  Filter,
  FolderOpen,
  LucideIcon,
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
  nodes: 'Data Tables',
  tasks: 'Tasks',
};
const MIN_SECTION_HEIGHT = 120;

const NAV_ITEMS: NavItem[] = [
  { id: 'data-loader', label: 'Data Loader', icon: FolderOpen },
  { id: 'filter', label: 'Data Structuring', icon: Filter },
  { id: 'token-frequency', label: 'Token Frequency', icon: TrendingUp },
  { id: 'concordance', label: 'Concordance', icon: FileText },
  { id: 'analysis', label: 'Sequential Analysis', icon: BarChart3 },
  { id: 'topic-modeling', label: 'Topic Modeling', icon: Puzzle },
  { id: 'quotation', label: 'Quotation', icon: Quote },
  { id: 'export', label: 'Export', icon: Upload },
];

const Sidebar: React.FC = () => {
  const { currentView, setCurrentView, openFeedbackModal, openTutorialTarget } = useUIStore(
    useShallow(({ currentView, setCurrentView, openFeedbackModal, openTutorialTarget }) => ({ currentView, setCurrentView, openFeedbackModal, openTutorialTarget }))
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

  React.useEffect(() => {
    if (!isWorkspaceLoaded && currentView !== 'data-loader') {
      setCurrentView('data-loader');
    }
  }, [currentView, isWorkspaceLoaded, setCurrentView]);

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
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
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
  const handleCancelTask = async (task: SidebarTaskRecord) => {
    if (!currentWorkspaceId) return;
    try {
      await workspacesApi.cancelTasks(currentWorkspaceId, { task_id: task.task_id }, getAuthHeaders());
      setTasks((prev) =>
        prev.map((item) =>
          item.task_id === task.task_id ? { ...item, state: 'cancelled' } : item
        )
      );
    } catch (error) {
      console.error('Failed to cancel task', error);
    }
  };

  const handleClearTask = async (task: SidebarTaskRecord) => {
    if (!currentWorkspaceId) return;
    try {
      await workspacesApi.clearTasks(currentWorkspaceId, { task_id: task.task_id }, getAuthHeaders());
      setTasks((prev) => prev.filter((item) => item.task_id !== task.task_id));
    } catch (error) {
      console.error('Failed to clear task', error);
    }
  };

  return (
    <SidebarRoot>
      <SidebarHeader className="border-b border-border/40 px-3 py-2">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2 w-full">
            <div className="flex items-center gap-2 w-full">
              <SidebarTrigger className="md:hidden" />
              <img src={logo} alt="LDaCA Logo" className="w-full h-auto object-contain" />
            </div>
            <div className="flex min-w-0 flex-col leading-tight w-full">
              <p className="text-xl font-semibold w-full">Text Analytics</p>
              {isMultiUserMode && (
                <p className="text-[11px] text-muted-foreground truncate" title={user?.name ?? 'Guest'}>
                  Welcome, {user?.name ?? 'Guest'}
                </p>
              )}
            </div>
          </div>
          {isMultiUserMode && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-red-600 hover:text-red-700 shrink-0"
              onClick={logout}
            >
              Logout
            </Button>
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
                  <button
                    type="button"
                    className="flex w-full items-center justify-between border-b border-border/40 bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    onClick={() => toggleSection(key)}
                    aria-expanded={!isCollapsed}
                  >
                    <span>{title}</span>
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
                        className="flex h-full min-h-0 flex-col overflow-y-auto px-2 py-2 text-sm"
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
                            onCancelTask={handleCancelTask}
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
        <div
          className="rounded-md border border-border/60 bg-muted/30 px-3 py-2"
          data-testid="sidebar-data-directory"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">Working directory</p>
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
        <div className="flex gap-2">
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
      </SidebarFooter>

      <SidebarRail />
      <DataFolderDialog
        open={isDataFolderDialogOpen}
        onOpenChange={setIsDataFolderDialogOpen}
      />
    </SidebarRoot>
  );
};

export default Sidebar;
