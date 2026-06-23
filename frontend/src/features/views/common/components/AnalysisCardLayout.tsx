import React from 'react';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { cn } from '@/lib/utils';
import { Loader2, Play, Square, Trash2 } from 'lucide-react';

interface HelpConfig {
  targetKey: string;
  label?: string;
  tooltip?: string;
}

interface AnalysisCardLayoutProps {
  title: React.ReactNode;
  info?: HelpConfig;
  help?: HelpConfig;
  tone?: 'default' | 'error';
  headerActions?: React.ReactNode;
  actions?: {
    onRun: () => void | Promise<void>;
    onStop?: () => void | Promise<void>;
    onClear: () => void | Promise<void>;
    runDisabled?: boolean;
    runDisabledReason?: string;
    stopDisabled?: boolean;
    clearDisabled?: boolean;
    isRunning?: boolean;
    isStopping?: boolean;
    isClearing?: boolean;
    hasResult?: boolean;
    runLabel?: string;
    runHelp?: HelpConfig;
    stopHelp?: HelpConfig;
    clearHelp?: HelpConfig;
    extraContent?: React.ReactNode;
  };
  children: React.ReactNode;
  footer?: React.ReactNode;
  cardRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Provides the shared card chrome for analysis feature panels, including help
 * affordances and consistent run/stop/clear controls.
 * Used by: token-frequency, quotation, sequential, topic-modeling, and AI panels because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export function AnalysisCardLayout({
  title,
  info,
  help,
  tone = 'default',
  headerActions,
  actions,
  children,
  footer,
  cardRef,
}: AnalysisCardLayoutProps) {
  const cardToneClassName = cn('w-full min-w-0', tone === 'error' && 'border-destructive/50');
  const runLabel = actions
    ? (actions.runLabel ?? (actions.isRunning ? 'Running' : actions.hasResult ? 'Re-run' : 'Run'))
    : 'Run';

  return (
    <Card ref={cardRef} className={cardToneClassName}>
      <CardHeader className="space-y-0 pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            {title}
            {info ? (
              <InfoIcon targetKey={info.targetKey} label={info.label} tooltip={info.tooltip} />
            ) : null}
            {help ? (
              <HelpIcon targetKey={help.targetKey} label={help.label} tooltip={help.tooltip} />
            ) : null}
          </CardTitle>
          {headerActions ? (
            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
              {headerActions}
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="pt-0">{children}</CardContent>

      {actions ? (
        <CardFooter className="flex flex-wrap items-center gap-3 pt-0">
          <div className="flex items-center gap-2">
            <DisabledReasonTooltip reason={actions.runDisabledReason}>
              <Button
                onClick={() => {
                  void actions.onRun();
                }}
                disabled={actions.runDisabled}
                className="w-full sm:w-auto"
              >
                {actions.isRunning ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {runLabel}
              </Button>
            </DisabledReasonTooltip>
            {actions.runHelp ? (
              <HelpIcon
                targetKey={actions.runHelp.targetKey}
                label={actions.runHelp.label}
                tooltip={actions.runHelp.tooltip}
              />
            ) : null}
          </div>

          {actions.onStop && actions.isRunning ? (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  void actions.onStop?.();
                }}
                variant="outline"
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- boolean OR: disabled when either flag is true
                disabled={actions.stopDisabled || actions.isStopping}
              >
                {actions.isStopping ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Square className="mr-2 h-4 w-4" />
                )}
                Stop
              </Button>
              {actions.stopHelp ? (
                <HelpIcon
                  targetKey={actions.stopHelp.targetKey}
                  label={actions.stopHelp.label}
                  tooltip={actions.stopHelp.tooltip}
                />
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                void actions.onClear();
              }}
              variant="destructive"
              disabled={actions.clearDisabled}
            >
              {actions.isClearing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Clear Results
            </Button>
            {actions.clearHelp ? (
              <HelpIcon
                targetKey={actions.clearHelp.targetKey}
                label={actions.clearHelp.label}
                tooltip={actions.clearHelp.tooltip}
              />
            ) : null}
          </div>

          {actions.extraContent}
        </CardFooter>
      ) : null}

      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}
