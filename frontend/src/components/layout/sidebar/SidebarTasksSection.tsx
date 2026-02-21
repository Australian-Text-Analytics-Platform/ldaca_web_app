import React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle, Clock, Square, XCircle } from 'lucide-react';
import type { SidebarTaskRecord, SidebarTaskStatus } from './types';

const CLEARABLE_STATES: SidebarTaskStatus[] = ['successful', 'failed', 'cancelled'];

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
  onCancelTask: (task: SidebarTaskRecord) => void;
  onClearTask: (task: SidebarTaskRecord) => void;
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

const SidebarTasksSection: React.FC<SidebarTasksSectionProps> = ({
  tasks,
  isConnected,
  isConnecting,
  connectionError,
  onReconnect,
  onCancelTask,
  onClearTask,
}) => {
  const sortedTasks = Array.isArray(tasks)
    ? tasks
        .slice()
        .sort((a, b) => {
          const kb = normalizeTimestamp(b.finished_at ?? b.started_at ?? b.created_at ?? 0);
          const ka = normalizeTimestamp(a.finished_at ?? a.started_at ?? a.created_at ?? 0);
          return kb - ka;
        })
    : [];

  const statusMeta = (status?: string) => STATUS_META[status ?? ''] ?? STATUS_META.default;

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
                        onClick={() => onCancelTask(task)}
                      >
                        Cancel
                      </Button>
                    )}
                    {task.state && CLEARABLE_STATES.includes(task.state) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onClearTask(task)}
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
                        'bg-emerald-500/20 **:data-[slot=progress-indicator]:bg-emerald-500':
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
};

export default SidebarTasksSection;
