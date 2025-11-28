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
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspaceTaskStream } from '@/hooks/useWorkspaceTaskStream';
import { useAuth } from '@/hooks/useAuth';
import { workspacesApi } from '@/api/workspaces';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { useQuotationEngineDialogStore } from '@/stores/quotationEngineStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CheckCircle,
  Circle,
  Cog,
  Clock,
  FileText,
  Filter,
  FolderOpen,
  LucideIcon,
  MessageSquare,
  Puzzle,
  Quote,
  Square,
  TrendingUp,
  Upload,
  XCircle,
  Copy,
  Check,
  ChevronDown,
} from 'lucide-react';
import type { ViewType } from '@/stores';
import logo from '@/logo.png';

type TaskStatus = 'running' | 'successful' | 'failed' | 'cancelled';

type TaskRecord = {
  task_id: string;
  task_type: string;
  state?: TaskStatus;
  metadata?: { name?: string };
  message?: string;
  created_at?: number;
  started_at?: number;
  finished_at?: number | null;
  progress?: number;
  progress_message?: string;
};

type NavItem = {
  id: ViewType;
  label: string;
  icon: LucideIcon;
};

type WorkspaceNode = {
  id: string;
  label?: string;
  type?: string;
  data?: {
    nodeName?: string;
    label?: string;
    nodeType?: string;
    dataType?: string;
    shape?: [number, number];
    [key: string]: unknown;
  };
};

type SectionKey = 'views' | 'nodes' | 'tasks';

const SECTION_KEYS: SectionKey[] = ['views', 'nodes', 'tasks'];
const SECTION_TITLES: Record<SectionKey, string> = {
  views: 'Views',
  nodes: 'Nodes',
  tasks: 'Tasks',
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
  { id: 'export', label: 'Export', icon: Upload },
];

const STATUS_META: Record<
  string,
  { icon: LucideIcon; className: string; label: string }
> = {
  running: { icon: Clock, className: 'text-amber-600', label: 'Running' },
  successful: { icon: CheckCircle, className: 'text-green-600', label: 'Successful' },
  failed: { icon: XCircle, className: 'text-red-600', label: 'Failed' },
  cancelled: { icon: Square, className: 'text-muted-foreground', label: 'Cancelled' },
  pending: { icon: Clock, className: 'text-muted-foreground', label: 'Pending' },
  default: { icon: AlertCircle, className: 'text-muted-foreground', label: 'Unknown' },
};

const CLEARABLE_STATES: TaskStatus[] = ['successful', 'failed', 'cancelled'];

const Sidebar: React.FC = () => {
  const { currentView, setCurrentView, openFeedbackModal } = useUIStore(
    useShallow(({ currentView, setCurrentView, openFeedbackModal }) => ({ currentView, setCurrentView, openFeedbackModal }))
  );
  const { workspaceGraph, currentWorkspaceId, getNodeShape } = useWorkspaceData();
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

  const nodes = React.useMemo<WorkspaceNode[]>(() => {
    const rawNodes = (workspaceGraph as { nodes?: unknown } | undefined)?.nodes;
    return Array.isArray(rawNodes) ? (rawNodes as WorkspaceNode[]) : [];
  }, [workspaceGraph]);

  const openQuotationEngineDialog = React.useCallback(() => {
    setCurrentView('quotation');
    openEngineDialog();
  }, [setCurrentView, openEngineDialog]);

  const nodeCount = nodes.length;
  const sortedTasks = React.useMemo<TaskRecord[]>(() => {
    if (!Array.isArray(tasks)) return [];
    return tasks
      .slice()
      .sort((a: TaskRecord, b: TaskRecord) => {
        const kb = b.finished_at ?? b.started_at ?? b.created_at ?? 0;
        const ka = a.finished_at ?? a.started_at ?? a.created_at ?? 0;
        return kb - ka;
      });
  }, [tasks]);

  const statusMeta = (status?: string) => STATUS_META[status ?? ''] ?? STATUS_META.default;
  const isConnected = taskStreamStatus === 'open';
  const isConnecting = taskStreamStatus === 'connecting';
  const connectionError = taskStreamStatus === 'error' ? taskStreamError : null;

  const [copiedField, setCopiedField] = React.useState<{ nodeId: string; field: 'name' | 'id' } | null>(null);
  const copyTimeoutRef = React.useRef<number | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null);
  const [nodeShapes, setNodeShapes] = React.useState<Record<string, string>>({});
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
  const assignSectionScrollRef = React.useCallback(
    (key: SectionKey, node: HTMLDivElement | null) => {
      sectionScrollRefs.current[key] = node;
    },
    []
  );
  const scrollSection = React.useCallback((key: SectionKey, deltaPixels: number) => {
    if (deltaPixels === 0) {
      return;
    }
    const target = sectionScrollRefs.current[key];
    if (!target) {
      return;
    }
    target.scrollTop += deltaPixels;
  }, []);

  const handleCopy = React.useCallback(
    async (value: string | undefined | null, nodeId: string, field: 'name' | 'id') => {
      if (!value || typeof value !== 'string') {
        return;
      }
      if (typeof window === 'undefined') {
        return;
      }

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else if (typeof document !== 'undefined') {
          const textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }

        setCopiedField({ nodeId, field });
        if (copyTimeoutRef.current) {
          window.clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopiedField(null);
        }, 1600);
      } catch (error) {
        console.error('Sidebar: failed to copy value', error);
      }
    },
    []
  );

  React.useEffect(() => () => {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
  }, []);

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

  const activeSectionTotal = React.useMemo(() => {
    const total = SECTION_KEYS.reduce((sum, key) => {
      if (collapsedSections[key]) {
        return sum;
      }
      return sum + (sectionHeights[key] ?? 0);
    }, 0);
    return total || 1;
  }, [collapsedSections, sectionHeights]);

  const getSectionFlexStyle = React.useCallback(
    (key: SectionKey) => {
      if (collapsedSections[key]) {
        return { flex: '0 0 auto' } as React.CSSProperties;
      }
      const ratio = (sectionHeights[key] ?? 0) / activeSectionTotal;
      return { flexGrow: ratio, flexShrink: 0, flexBasis: 0 } as React.CSSProperties;
    },
    [collapsedSections, sectionHeights, activeSectionTotal]
  );

  const toggleSection = React.useCallback((key: SectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleResizeStart = React.useCallback(
    (upperKey: SectionKey, lowerKey: SectionKey, event: React.MouseEvent<HTMLDivElement>) => {
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
    },
    [collapsedSections, sectionHeights, sectionsContainerHeight, scrollSection]
  );

  const renderViewsBody = () => (
    <SidebarMenu>
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const isQuotation = id === 'quotation';
        return (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton
              isActive={currentView === id}
              onClick={() => setCurrentView(id)}
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
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
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

  const renderNodesBody = () => (
    <div className="flex flex-col gap-2" onMouseLeave={() => setHoveredNodeId(null)}>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Total: {nodeCount}</span>
        <span>Selected: {selectedNodeIds?.length ?? 0}</span>
      </div>
      <div className="space-y-2 pr-1">
        {nodes.length ? (
          nodes.map((node) => {
            const name = node?.data?.nodeName || node?.data?.label || node?.label || '';
            const dtype = node?.data?.nodeType || node?.data?.dataType || node?.type || 'unknown';
            const shape = nodeShapes[node.id] || '—';
            const checked = selectedNodeIds?.includes(node.id);
            const copyNameValue = name && name.length > 0 ? name : node.id;
            const displayName = copyNameValue || 'Untitled node';
            const isNameCopied = copiedField?.nodeId === node.id && copiedField.field === 'name';
            const isIdCopied = copiedField?.nodeId === node.id && copiedField.field === 'id';
            const isExpanded = hoveredNodeId === node.id;

            return (
              <div
                key={node.id}
                className={cn(
                  'group relative overflow-hidden rounded-md border border-transparent bg-background/40 px-2 py-2 text-sm transition-all duration-200 ease-out focus-within:border-border/60 focus-within:bg-accent/60',
                  checked
                    ? 'border-primary/60 bg-primary/10'
                    : 'hover:border-border/60 hover:bg-accent/60',
                  isExpanded && !checked && 'border-border/60 bg-accent/60 shadow-sm'
                )}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
                onFocusCapture={() => setHoveredNodeId(node.id)}
                onBlurCapture={(event) => {
                  const related = event.relatedTarget as Node | null;
                  if (!related || !event.currentTarget.contains(related)) {
                    setHoveredNodeId((prev) => (prev === node.id ? null : prev));
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleNodeSelection(node.id)}
                    className="h-5 w-5 shrink-0 rounded-full border-border/70 text-primary-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                    aria-label={`Select ${displayName}`}
                  />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCopy(copyNameValue, node.id, 'name');
                    }}
                    className="flex flex-1 min-w-0 items-center gap-2 bg-transparent text-left text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title={displayName}
                  >
                    <span className="flex-1 min-w-0 truncate">{displayName}</span>
                    <span
                      className={cn(
                        'flex items-center shrink-0 text-xs text-muted-foreground transition-opacity duration-200 ease-out',
                        hoveredNodeId === node.id ? 'opacity-100' : 'opacity-0'
                      )}
                    >
                      {isNameCopied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                </div>
                <div
                  className={cn(
                    'ml-[1.75rem] mt-0 flex max-h-0 flex-wrap items-center gap-x-4 gap-y-1 overflow-hidden text-xs text-muted-foreground opacity-0 transition-all duration-200 ease-out',
                    isExpanded && 'mt-2 max-h-40 opacity-100'
                  )}
                >
                  <span className="flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">Type</span>
                    <span className="font-medium text-foreground">{dtype}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">Shape</span>
                    <span className="font-medium text-foreground">{shape}</span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCopy(node.id, node.id, 'id');
                    }}
                    className="flex items-center gap-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title="Copy node id"
                  >
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">ID</span>
                    <span className="max-w-[160px] truncate font-mono text-[11px] text-foreground">{node.id}</span>
                    {isIdCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-md bg-accent/40 px-2 py-2 text-xs text-muted-foreground">No nodes</div>
        )}
      </div>
    </div>
  );

  const renderTasksBody = () => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {connectionError
            ? connectionError
            : isConnecting
              ? 'Connecting...'
              : isConnected
                ? 'Live updates'
                : 'Idle'}
        </span>
        {connectionError && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-red-600"
            onClick={reconnectTaskStream}
            title="Retry connection"
          >
            Retry
          </Button>
        )}
      </div>
      <div className="space-y-1">
        {sortedTasks.length ? (
          sortedTasks.map((task) => {
            const meta = statusMeta(task.state);
            const StatusIcon = meta.icon;
            const rawProgress = Math.max(0, Math.min(1, task.progress ?? 0));
            const progressPercent = Math.round(rawProgress * 100);
            const hasProgressValue = typeof task.progress === 'number' && task.progress >= 0;
            const isComplete =
              hasProgressValue && progressPercent >= 100 && task.state === 'successful';
            const showProgress =
              hasProgressValue &&
              !isComplete &&
              (task.state === 'running' || task.state === 'successful');
            return (
              <div
                key={task.task_id}
                className={cn(
                  'rounded-md border border-border/40 bg-background px-3 py-2',
                  isComplete && 'py-1.5'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-1 items-start gap-2">
                    <StatusIcon className={cn('h-4 w-4 mt-0.5 shrink-0', meta.className)} />
                    <div className={cn('min-w-0 space-y-1', isComplete && 'space-y-0.5')}>
                      <p className="text-xs font-medium capitalize text-foreground">
                        {task.task_type?.replace(/_/g, ' ') || 'task'}
                        {task.metadata?.name ? `: ${task.metadata.name}` : ''}
                      </p>
                      {task.message && (
                        <p className="text-[11px] text-muted-foreground" title={task.message}>
                          {task.message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {task.state === 'running' && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleCancelTask(task)}
                      >
                        Cancel
                      </Button>
                    )}
                    {task.state && CLEARABLE_STATES.includes(task.state) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleClearTask(task)}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>
                {showProgress && (
                  <div className="mt-2 space-y-1">
                    <Progress
                      value={progressPercent}
                      className={cn('h-1.5', {
                        'bg-emerald-500/20 [&_[data-slot=progress-indicator]]:bg-emerald-500':
                          task.state === 'successful',
                      })}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {progressPercent}%
                      {task.progress_message ? ` • ${task.progress_message}` : ''}
                    </p>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="rounded-md bg-accent/40 px-3 py-2 text-xs text-muted-foreground">
            No tasks
          </div>
        )}
      </div>
    </div>
  );

  // Fetch shapes for visible nodes
  React.useEffect(() => {
    if (!getNodeShape || nodes.length === 0) return;
    
    let cancelled = false;
    
    const fetchShapes = async () => {
      const promises = nodes.map(async (node) => {
        if (nodeShapes[node.id]) return; // Already have this shape
        
        try {
          const cacheKey = `node-shape:${node.id}`;
          const cached = typeof window !== 'undefined' ? window.sessionStorage.getItem(cacheKey) : null;
          if (cached) {
            if (!cancelled) {
              setNodeShapes(prev => ({ ...prev, [node.id]: cached }));
            }
            return;
          }
          
          const shapeData = await getNodeShape(node.id);
          if (!cancelled && shapeData?.shape) {
            const shapeStr = `${shapeData.shape[0]} × ${shapeData.shape[1]}`;
            setNodeShapes(prev => ({ ...prev, [node.id]: shapeStr }));
            
            try {
              if (typeof window !== 'undefined') {
                window.sessionStorage.setItem(cacheKey, shapeStr);
              }
            } catch {
              // ignore storage errors
            }
          }
        } catch {
          // ignore fetch errors
        }
      });
      
      await Promise.all(promises);
    };
    
    fetchShapes();
    
    return () => {
      cancelled = true;
    };
  }, [getNodeShape, nodes, nodeShapes]);

  const handleCancelTask = React.useCallback(
    async (task: TaskRecord) => {
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
    },
    [currentWorkspaceId, getAuthHeaders, setTasks]
  );

  const handleClearTask = React.useCallback(
    async (task: TaskRecord) => {
      if (!currentWorkspaceId) return;
      try {
        await workspacesApi.clearTasks(currentWorkspaceId, { task_id: task.task_id }, getAuthHeaders());
  setTasks((prev) => prev.filter((item) => item.task_id !== task.task_id));
      } catch (error) {
        console.error('Failed to clear task', error);
      }
    },
    [currentWorkspaceId, getAuthHeaders, setTasks]
  );

  return (
    <SidebarRoot>
      <SidebarHeader className="border-b border-border/40 px-3 py-2">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SidebarTrigger className="md:hidden" />
            <img src={logo} alt="LDaCA Logo" className="h-8 w-auto" />
            <div className="flex min-w-0 flex-col leading-tight">
              <p className="text-sm font-semibold">LDaCA Corpus Analysis</p>
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
        {dataFolder && (
          <p className="mt-1 text-[10px] text-muted-foreground/70 break-all leading-tight">
            Data: {dataFolder}
          </p>
        )}
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
                    isCollapsed ? 'max-h-0' : 'max-h-[999px]'
                  )}
                >
                  {!isCollapsed && (
                    <div className="flex h-full flex-col overflow-hidden">
                      <div
                        ref={(node) => assignSectionScrollRef(key, node)}
                        className="flex h-full min-h-0 flex-col overflow-y-auto px-2 py-2 text-sm"
                      >
                        {key === 'views' && renderViewsBody()}
                        {key === 'nodes' && renderNodesBody()}
                        {key === 'tasks' && renderTasksBody()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SidebarContent>

      <SidebarFooter className="px-3 py-2">
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1 justify-center"
            onClick={() => window.open('#/tutorial', '_blank', 'noopener,noreferrer')}
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
    </SidebarRoot>
  );
};

export default Sidebar;
