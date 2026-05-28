import React from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface AnalysisTaskBannerProps {
  analysisName: string;
  status?: 'running' | 'queued';
  taskId?: string | null;
  message?: string;
  className?: string;
  children?: React.ReactNode;
}

/** Visual treatment map for queued versus actively running analysis task banners. */
const statusStyles: Record<
  NonNullable<AnalysisTaskBannerProps['status']>,
  { card: string; text: string; badge: string }
> = {
  running: {
    card: 'border-amber-200 bg-amber-50/80',
    text: 'text-amber-900',
    badge: 'border-amber-300 bg-white/70',
  },
  queued: {
    card: 'border-sky-200 bg-sky-50/80',
    text: 'text-sky-900',
    badge: 'border-sky-300 bg-white/70',
  },
};

/**
 * Shows task-store banner state above analysis results while a queued or running
 * backend task owns the next refresh for the active feature.
 * Used by: task-backed analysis feature screens because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
function AnalysisTaskBanner({
  analysisName,
  status = 'running',
  taskId,
  message,
  className,
  children,
}: AnalysisTaskBannerProps) {
  const styles = statusStyles[status] ?? statusStyles.running;
  const trimmedMessage = message?.trim();

  return (
    <Card className={cn('shadow-sm', styles.card, className)} data-testid="analysis-task-card">
      <CardContent
        className={cn('flex items-start gap-3 py-4 text-sm', styles.text)}
        aria-label={`${analysisName} task ${status}${taskId ? ` (task ${taskId})` : ''}`}
      >
        <div
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border',
            styles.badge,
          )}
          data-testid="analysis-task-spinner"
        >
          <Loader2
            className="h-4 w-4 animate-spin"
            data-testid="analysis-task-spinner-icon"
            aria-hidden="true"
          />
        </div>
        <div className="space-y-1">
          {trimmedMessage && <p className="leading-tight">{trimmedMessage}</p>}
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

export default AnalysisTaskBanner;
