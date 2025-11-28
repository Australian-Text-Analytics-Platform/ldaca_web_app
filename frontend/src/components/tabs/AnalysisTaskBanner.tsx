import React from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';

interface AnalysisTaskBannerProps {
  analysisName: string;
  status?: 'running' | 'queued';
  taskId?: string | null;
  message?: string;
  className?: string;
  children?: React.ReactNode;
}

const statusStyles: Record<NonNullable<AnalysisTaskBannerProps['status']>, { card: string; text: string; badge: string }> = {
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

const AnalysisTaskBanner: React.FC<AnalysisTaskBannerProps> = ({
  analysisName,
  status = 'running',
  taskId,
  message,
  className,
  children,
}) => {
  const styles = statusStyles[status] ?? statusStyles.running;
  const trimmedMessage = message?.trim();

  return (
    <Card className={cn('shadow-sm', styles.card, className)}>
      <CardContent
        className={cn('flex items-start gap-3 py-4 text-sm', styles.text)}
        aria-label={`${analysisName} task ${status}${taskId ? ` (task ${taskId})` : ''}`}
      >
        <div className={cn('flex h-6 w-6 items-center justify-center rounded-full border', styles.badge)}>
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
        <div className="space-y-1">
          {trimmedMessage && (
            <p className="leading-tight">{trimmedMessage}</p>
          )}
          {children}
        </div>
      </CardContent>
    </Card>
  );
};

export default AnalysisTaskBanner;
