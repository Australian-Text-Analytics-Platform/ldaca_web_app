import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

type AnalysisRunningStateCardProps = {
  title?: string;
  message: string;
  taskId?: string | null;
  progress?: number | null;
  startedAt?: string | number | null;
};

// Backend sends started_at as time.time() (Unix seconds). Convert to ms when needed.
/** Called by: running-state elapsed time calculations because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const toMs = (v: number) => (v < 1e12 ? v * 1000 : v);

/**
 * Tracks elapsed task runtime for running-state cards without requiring every
 * feature to own an interval timer.
 * Used by: AnalysisRunningStateCard because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: initialize elapsed seconds from started_at, tick every second while a valid start exists, then clear the interval when the card unmounts or task changes.
 */
function useElapsedSeconds(startedAt: string | number | null | undefined): number {
  const [elapsed, setElapsed] = useState<number>(() => {
    if (!startedAt) return 0;
    const start = typeof startedAt === 'number' ? toMs(startedAt) : Date.parse(startedAt);
    return isNaN(start) ? 0 : Math.max(0, Math.floor((Date.now() - start) / 1000));
  });

  useEffect(() => {
    if (!startedAt) return;
    const start = typeof startedAt === 'number' ? toMs(startedAt) : Date.parse(startedAt);
    if (isNaN(start)) return;
    /** Called by: the interval timer and initial effect pass because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

/** Called by: AnalysisRunningStateCard when rendering elapsed runtime text because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m} min ${s}s`;
}

/**
 * Displays progress and elapsed time for an analysis task that is still running
 * when the feature panel renders or hydrates from task state.
 * Used by: token-frequency and topic-modeling result panels because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export function AnalysisRunningStateCard({
  title = 'Task running',
  message,
  taskId,
  progress,
  startedAt,
}: AnalysisRunningStateCardProps) {
  // Backend sends progress as 0.0–1.0; convert to 0–100 for display
  const normalizedProgress =
    typeof progress === 'number' ? Math.max(0, Math.min(100, progress * 100)) : null;
  const elapsed = useElapsedSeconds(startedAt);

  return (
    <div className="space-y-3 rounded-md border border-amber-300/60 bg-amber-50/60 p-4 text-amber-900">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <div className="space-y-0.5 text-sm">
          <div className="flex items-baseline gap-3">
            <p className="font-medium">{title}</p>
            {elapsed > 0 && (
              <span className="text-xs text-amber-800/70">
                Running for {formatElapsed(elapsed)}
              </span>
            )}
          </div>
          <p className="text-amber-800/90">{message}</p>
          {taskId ? <p className="text-xs text-amber-800/80">Task ID: {taskId}</p> : null}
        </div>
      </div>

      {normalizedProgress !== null ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-amber-900/90">
            <span>Progress</span>
            <span>{Math.round(normalizedProgress)}%</span>
          </div>
          <Progress value={normalizedProgress} className="h-2 bg-amber-100" />
        </div>
      ) : null}
    </div>
  );
}
