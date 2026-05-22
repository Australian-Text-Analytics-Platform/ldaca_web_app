import React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle, ChevronDown, Clock, Square, XCircle } from 'lucide-react';
import type { SidebarTaskRecord } from './types';

const PROBLEMATIC_STATES = new Set(['failed', 'cancelled']);
const ACTIVE_STATES = new Set(['pending', 'queued', 'submitted', 'running']);

const STATUS_META: Record<string, { icon: typeof Clock; className: string; label: string }> = {
  running: { icon: Clock, className: 'text-amber-600', label: 'Running' },
  successful: { icon: CheckCircle, className: 'text-green-600', label: 'Successful' },
  failed: { icon: XCircle, className: 'text-red-600', label: 'Failed' },
  cancelled: { icon: Square, className: 'text-muted-foreground', label: 'Cancelled' },
  pending: { icon: Clock, className: 'text-muted-foreground', label: 'Pending' },
  default: { icon: AlertCircle, className: 'text-muted-foreground', label: 'Unknown' },
};

type SidebarTasksSectionProps = {
  tasks: SidebarTaskRecord[];
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  onReconnect: () => void;
};

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

const formatTimestamp = (value: unknown): string => {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return 'Not recorded';
  return new Date(timestamp).toLocaleString();
};

const taskTimestamp = (task: SidebarTaskRecord): number =>
  normalizeTimestamp(task.finished_at ?? task.started_at ?? task.created_at ?? 0);

const taskPriority = (task: SidebarTaskRecord): number => {
  const state = String(task.state ?? '').toLowerCase();
  if (PROBLEMATIC_STATES.has(state)) return 0;
  if (ACTIVE_STATES.has(state)) return 1;
  if (state === 'successful') return 2;
  return 3;
};

const taskLabel = (task: SidebarTaskRecord): string => {
  const typeLabel = task.task_type?.replace(/_/g, ' ') || 'task';
  return task.name ? `${typeLabel}: ${task.name}` : typeLabel;
};

const SidebarTasksSection: React.FC<SidebarTasksSectionProps> = ({
  tasks,
  isConnected,
  isConnecting,
  connectionError,
  onReconnect,
}) => {
  const sortedTasks = Array.isArray(tasks)
    ? tasks
        .slice()
        .sort((a, b) => {
          const priorityDelta = taskPriority(a) - taskPriority(b);
          if (priorityDelta !== 0) return priorityDelta;
          return taskTimestamp(b) - taskTimestamp(a);
        })
    : [];

  const [expandedTaskIds, setExpandedTaskIds] = React.useState<Set<string>>(() => new Set());

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

  const statusMeta = (status?: string) => STATUS_META[status ?? ''] ?? STATUS_META['default']!;

  const connectionLabel = connectionError
    ? connectionError
    : isConnecting
      ? 'Connecting...'
      : isConnected
        ? 'Live updates'
        : 'Idle';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{connectionLabel}</span>
        {connectionError && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-red-600"
            onClick={onReconnect}
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
            const expanded = expandedTaskIds.has(task.task_id);
            const label = taskLabel(task);

            return (
              <div
                key={task.task_id}
                className={cn(
                  'rounded-md border bg-background text-left transition-colors',
                  PROBLEMATIC_STATES.has(String(task.state ?? '').toLowerCase())
                    ? 'border-red-200 bg-red-50/50 dark:border-red-950 dark:bg-red-950/20'
                    : 'border-border/40'
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  aria-label={`Task: ${label}. ${expanded ? 'Collapse details' : 'Expand details'}`}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => toggleExpanded(task.task_id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    toggleExpanded(task.task_id);
                  }}
                >
                  <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', meta.className)} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium capitalize text-foreground">
                    {label}
                  </span>
                  {showProgress && (
                    <Progress
                      value={progressPercent}
                      className={cn('h-1 w-14 shrink-0', {
                        'bg-emerald-500/20 **:data-[slot=progress-indicator]:bg-emerald-500':
                          task.state === 'successful',
                      })}
                    />
                  )}
                  <ChevronDown
                    className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
                  />
                </div>

                {expanded && (
                  <div className="space-y-2 border-t border-border/40 px-2.5 py-2">
                    {showProgress && (
                      <div className="space-y-1">
                        <Progress
                          value={progressPercent}
                          className={cn('h-1.5', {
                            'bg-emerald-500/20 **:data-[slot=progress-indicator]:bg-emerald-500':
                              task.state === 'successful',
                          })}
                        />
                        <p className="text-[10px] text-muted-foreground">{progressPercent}%</p>
                      </div>
                    )}
                    {task.message && (
                      <p className="text-[11px] text-muted-foreground">{task.message}</p>
                    )}
                    {task.progress_message && task.progress_message !== task.message && (
                      <p className="text-[11px] text-muted-foreground">{task.progress_message}</p>
                    )}
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                      <dt>Created</dt>
                      <dd className="truncate">{formatTimestamp(task.created_at)}</dd>
                      <dt>Started</dt>
                      <dd className="truncate">{formatTimestamp(task.started_at)}</dd>
                      <dt>Finished</dt>
                      <dd className="truncate">{formatTimestamp(task.finished_at)}</dd>
                    </dl>
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
};

export default SidebarTasksSection;
