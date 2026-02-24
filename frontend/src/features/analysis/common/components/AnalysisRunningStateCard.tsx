import React from 'react';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

type AnalysisRunningStateCardProps = {
  title?: string;
  message: string;
  taskId?: string | null;
  progress?: number | null;
};

export function AnalysisRunningStateCard({
  title = 'Task running',
  message,
  taskId,
  progress,
}: AnalysisRunningStateCardProps) {
  const normalizedProgress =
    typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : null;

  return (
    <div className="space-y-3 rounded-md border border-amber-300/60 bg-amber-50/60 p-4 text-amber-900">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">{title}</p>
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