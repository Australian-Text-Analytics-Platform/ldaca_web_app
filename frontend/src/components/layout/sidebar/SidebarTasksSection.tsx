import React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle, ChevronDown, Clock, Square, XCircle } from 'lucide-react';
import type { TaskItem } from '@/features/workspace/task-stream/taskProjection';

/** Task states treated as attention-worthy in the sidebar task list. */
const PROBLEMATIC_STATES = new Set(['failed', 'cancelled']);
/** Task states considered live/in-progress for sorting and status display. */
const ACTIVE_STATES = new Set(['queued', 'running']);

/** Display metadata consumed by task rows to keep icon, label, and color consistent. */
const DEFAULT_STATUS_META = {
  icon: AlertCircle,
  className: 'text-description',
  label: 'Unknown',
};
const STATUS_META: Record<string, { icon: typeof Clock; className: string; label: string }> = {
  running: { icon: Clock, className: 'text-warning', label: 'Running' },
  queued: { icon: Clock, className: 'text-description', label: 'Queued' },
  successful: {
    icon: CheckCircle,
    className: 'text-[var(--vscode-charts-green)]',
    label: 'Successful',
  },
  failed: { icon: XCircle, className: 'text-error', label: 'Failed' },
  cancelled: { icon: Square, className: 'text-description', label: 'Cancelled' },
  default: DEFAULT_STATUS_META,
};

interface SidebarTasksSectionProps {
  tasks: TaskItem[];
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  onReconnect: () => void;
  onStopUserFileImport: (importId: string) => void;
  onClearUserFileImport: (importId: string) => void;
  stoppingImportId: string | null;
  clearingImportId: string | null;
}

/** Called by: SidebarTasksSection sorting and expanded timestamp formatting. */
const normalizeTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
};

/** Called by: SidebarTasksSection expanded task detail rows. */
const formatTimestamp = (value: unknown): string => {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return 'Not recorded';
  return new Date(timestamp).toLocaleString();
};

/** Called by: SidebarTasksSection task sorting. */
const taskTimestamp = (task: TaskItem): number =>
  normalizeTimestamp(task.finished_at ?? task.started_at ?? task.created_at ?? 0);

/** Called by: SidebarTasksSection task sorting. */
const taskPriority = (task: TaskItem): number => {
  const state = task.state.toLowerCase();
  if (PROBLEMATIC_STATES.has(state)) return 0;
  if (ACTIVE_STATES.has(state)) return 1;
  if (state === 'successful') return 2;
  return 3;
};

/** Called by: SidebarTasksSection row rendering and accessibility labels. */
const taskLabel = (task: TaskItem): string => {
  const typeLabel = task.task_type.replace(/_/g, ' ') || 'task';
  return task.name ? `${typeLabel}: ${task.name}` : typeLabel;
};

/**
 * Task stream section used inside the sidebar. It shows connection health,
 * prioritizes active/problematic jobs, and lets users expand rows for backend
 * task timing/progress details.
 * Rendered by: Sidebar's Tasks section because task stream health and recent job state need to stay visible beside navigation.
 * Flow: sort tasks by priority and timestamp, manage expanded rows, then render connection status, retry action, and task details.
 */
function SidebarTasksSection({
  tasks,
  isConnected,
  isConnecting,
  connectionError,
  onReconnect,
  onStopUserFileImport,
  onClearUserFileImport,
  stoppingImportId,
  clearingImportId,
}: SidebarTasksSectionProps) {
  const sortedTasks = Array.isArray(tasks)
    ? tasks.slice().sort((a, b) => {
        const priorityDelta = taskPriority(a) - taskPriority(b);
        if (priorityDelta !== 0) return priorityDelta;
        return taskTimestamp(b) - taskTimestamp(a);
      })
    : [];

  const [expandedTaskIds, setExpandedTaskIds] = React.useState<Set<string>>(() => new Set());

  /** Called by: SidebarTasksSection task row click and keyboard handlers. */
  const toggleExpanded = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  /** Called by: SidebarTasksSection row rendering for task status icons and labels. */
  const statusMeta = (status?: string) => STATUS_META[status ?? ''] ?? DEFAULT_STATUS_META;

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string error should still fall through to live connection status
  const connectionLabel = connectionError
    ? connectionError
    : isConnecting
      ? 'Connecting...'
      : isConnected
        ? ''
        : 'Idle';

  return (
    <div className="flex flex-col gap-2">
      {connectionLabel && (
        <div className="flex items-center justify-between text-[11px] text-description">
          <span>{connectionLabel}</span>
          {connectionError && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-error"
              onClick={onReconnect}
              title="Retry connection"
            >
              Retry
            </Button>
          )}
        </div>
      )}
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
            const expanded = expandedTaskIds.has(task.task_id);
            const label = taskLabel(task);
            const isUserFileImport = task.resource_type === 'user_file_import';
            const canStop =
              isUserFileImport && (task.state === 'queued' || task.state === 'running');
            const canClear =
              isUserFileImport &&
              (task.state === 'successful' ||
                task.state === 'failed' ||
                task.state === 'cancelled');
            const isStopping = stoppingImportId === task.task_id;
            const isClearing = clearingImportId === task.task_id;

            return (
              <div
                key={task.task_id}
                className={cn(
                  'rounded-md border bg-editor text-left transition-colors',
                  PROBLEMATIC_STATES.has(task.state.toLowerCase())
                    ? 'border-error bg-error-background/50'
                    : 'border-surface-border/40',
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  aria-label={`Task: ${label}. ${expanded ? 'Collapse details' : 'Expand details'}`}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  onClick={() => {
                    toggleExpanded(task.task_id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    toggleExpanded(task.task_id);
                  }}
                >
                  <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', meta.className)} />
                  <span className="min-w-0 flex-1 truncate text-label-secondary font-medium capitalize text-foreground">
                    {label}
                  </span>
                  {showProgress && (
                    <Progress
                      value={progressPercent}
                      className={cn('h-1 w-14 shrink-0', {
                        'bg-[color-mix(in_srgb,var(--vscode-charts-green)_20%,transparent)] **:data-[slot=progress-indicator]:bg-[var(--vscode-charts-green)]':
                          task.state === 'successful',
                      })}
                    />
                  )}
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 shrink-0 text-description transition-transform',
                      expanded && 'rotate-180',
                    )}
                  />
                </div>

                {expanded && (
                  <div className="space-y-2 border-t border-surface-border/40 px-2.5 py-2">
                    {showProgress && (
                      <div className="space-y-1">
                        <Progress
                          value={progressPercent}
                          className={cn('h-1.5', {
                            'bg-[color-mix(in_srgb,var(--vscode-charts-green)_20%,transparent)] **:data-[slot=progress-indicator]:bg-[var(--vscode-charts-green)]':
                              task.state === 'successful',
                          })}
                        />
                        <p className="text-badge text-description">{progressPercent}%</p>
                      </div>
                    )}
                    {task.message && <p className="text-[11px] text-description">{task.message}</p>}
                    {(task.state === 'queued' || task.state === 'running') &&
                      task.progress_message &&
                      task.progress_message !== task.message && (
                        <p className="text-[11px] text-description">{task.progress_message}</p>
                      )}
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-badge text-description">
                      <dt>Created</dt>
                      <dd className="truncate">{formatTimestamp(task.created_at)}</dd>
                      <dt>Started</dt>
                      <dd className="truncate">{formatTimestamp(task.started_at)}</dd>
                      <dt>Finished</dt>
                      <dd className="truncate">{formatTimestamp(task.finished_at)}</dd>
                    </dl>
                    {(canStop || canClear) && (
                      <div className="flex justify-end border-t border-surface-border/40 pt-2">
                        {canStop ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            disabled={isStopping || isClearing}
                            onClick={() => {
                              onStopUserFileImport(task.task_id);
                            }}
                          >
                            {isStopping ? 'Stopping...' : 'Stop'}
                          </Button>
                        ) : null}
                        {canClear ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            disabled={isStopping || isClearing}
                            onClick={() => {
                              onClearUserFileImport(task.task_id);
                            }}
                          >
                            {isClearing ? 'Clearing...' : 'Clear'}
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="rounded-md bg-list-hover/40 px-3 py-2 text-label-secondary text-description">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

export default SidebarTasksSection;
