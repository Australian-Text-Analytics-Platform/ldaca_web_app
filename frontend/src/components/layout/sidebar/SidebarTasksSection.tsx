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
  onClearTask: (task: SidebarTaskRecord) => void;
};

// Auto-fade timing for successfully completed tasks. The task remains fully
// visible for VISIBLE_MS, then fades over FADE_MS before being cleared.
const SUCCESS_VISIBLE_MS = 7000;
const SUCCESS_FADE_MS = 1000;

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

  // Auto-fade and clear successfully completed tasks. Failed/cancelled tasks
  // are kept on screen until the user dismisses them manually.
  const [fadingTaskIds, setFadingTaskIds] = React.useState<Set<string>>(() => new Set());
  const taskTimersRef = React.useRef<Map<string, { fadeTimer: number; clearTimer: number }>>(
    new Map(),
  );
  const onClearTaskRef = React.useRef(onClearTask);
  React.useEffect(() => {
    onClearTaskRef.current = onClearTask;
  }, [onClearTask]);

  React.useEffect(() => {
    const visibleSuccessful = new Map<string, SidebarTaskRecord>();
    for (const task of tasks) {
      if (task.state === 'successful' && task.task_id) {
        visibleSuccessful.set(task.task_id, task);
      }
    }

    const timers = taskTimersRef.current;

    // Schedule fade/clear for newly successful tasks.
    visibleSuccessful.forEach((task, taskId) => {
      if (timers.has(taskId)) return;
      const fadeTimer = window.setTimeout(() => {
        setFadingTaskIds((prev) => {
          if (prev.has(taskId)) return prev;
          const next = new Set(prev);
          next.add(taskId);
          return next;
        });
      }, SUCCESS_VISIBLE_MS);
      const clearTimer = window.setTimeout(() => {
        timers.delete(taskId);
        setFadingTaskIds((prev) => {
          if (!prev.has(taskId)) return prev;
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
        try {
          onClearTaskRef.current(task);
        } catch (error) {
          console.error('SidebarTasksSection: auto-clear failed', error);
        }
      }, SUCCESS_VISIBLE_MS + SUCCESS_FADE_MS);
      timers.set(taskId, { fadeTimer, clearTimer });
    });

    // Cancel timers for tasks that are no longer visible/successful.
    timers.forEach((handles, taskId) => {
      if (!visibleSuccessful.has(taskId)) {
        window.clearTimeout(handles.fadeTimer);
        window.clearTimeout(handles.clearTimer);
        timers.delete(taskId);
        setFadingTaskIds((prev) => {
          if (!prev.has(taskId)) return prev;
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    });
  }, [tasks]);

  React.useEffect(() => {
    const timers = taskTimersRef.current;
    return () => {
      timers.forEach((handles) => {
        window.clearTimeout(handles.fadeTimer);
        window.clearTimeout(handles.clearTimer);
      });
      timers.clear();
    };
  }, []);

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

            return (
              <div
                key={task.task_id}
                className={cn(
                  'rounded-md border border-border/40 bg-background px-3 py-2 transition-opacity duration-1000 ease-out',
                  isComplete && 'py-1.5',
                  fadingTaskIds.has(task.task_id) && 'opacity-0 pointer-events-none'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-1 items-start gap-2">
                    <StatusIcon className={cn('h-4 w-4 mt-0.5 shrink-0', meta.className)} />
                    <div className={cn('min-w-0 space-y-1', isComplete && 'space-y-0.5')}>
                      <p className="text-xs font-medium capitalize text-foreground">
                        {task.task_type?.replace(/_/g, ' ') || 'task'}
                        {task.name ? `: ${task.name}` : ''}
                      </p>
                      {task.message && (
                        <p className="text-[11px] text-muted-foreground" title={task.message}>
                          {task.message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {(task.state === 'running' || (task.state && CLEARABLE_STATES.includes(task.state))) && (
                      <Button
                        variant={task.state === 'running' ? 'destructive' : 'outline'}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onClearTask(task)}
                      >
                        {task.state === 'running' ? 'Stop' : 'Clear'}
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
