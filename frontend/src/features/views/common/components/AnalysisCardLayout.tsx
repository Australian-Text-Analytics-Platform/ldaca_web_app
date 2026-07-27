import React from 'react';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { cn } from '@/lib/utils';
import { Loader2, Play, Square, Trash2 } from 'lucide-react';
import type { DocLinkKind, DocumentKey } from '@/tutorials/documentationRegistry';

interface HelpConfig<Kind extends DocLinkKind> {
  targetKey: DocumentKey<Kind>;
  label?: string;
  tooltip?: string;
}

interface AnalysisCardLayoutProps {
  title: React.ReactNode;
  info?: HelpConfig<'info'>;
  help?: HelpConfig<'tutorial'>;
  tone?: 'default' | 'error';
  headerActions?: React.ReactNode;
  actions?: {
    onPreview?: () => void | Promise<void>;
    onRunAll: () => void | Promise<void>;
    onStop?: () => void | Promise<void>;
    onClear: () => void | Promise<void>;
    previewDisabled?: boolean;
    previewDisabledReason?: string;
    runAllDisabled?: boolean;
    runAllDisabledReason?: string;
    stopDisabled?: boolean;
    stopDisabledReason?: string;
    clearDisabled?: boolean;
    clearDisabledReason?: string;
    isPreviewing?: boolean;
    isRunningAll?: boolean;
    isStopping?: boolean;
    isClearing?: boolean;
    hasResult?: boolean;
    previewLabel?: string;
    runAllLabel?: string;
    runAllHelp?: HelpConfig<'tutorial'>;
    stopHelp?: HelpConfig<'tutorial'>;
    clearHelp?: HelpConfig<'tutorial'>;
  };
  children: React.ReactNode;
  parametersLocked?: boolean;
  footer?: React.ReactNode;
  cardRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Provides the shared card chrome for analysis feature panels, including help
 * affordances and consistent run/stop/clear controls.
 * Used by: analysis panels.
 */
export function AnalysisCardLayout({
  title,
  info,
  help,
  tone = 'default',
  headerActions,
  actions,
  children,
  parametersLocked = false,
  footer,
  cardRef,
}: AnalysisCardLayoutProps) {
  const cardToneClassName = cn('w-full min-w-0', tone === 'error' && 'border-destructive/50');
  const previewLabel = actions?.previewLabel ?? 'Preview';
  const runAllLabel = actions?.runAllLabel ?? 'Run All';
  const previewDisabledReason = actions?.previewDisabled
    ? actions.isPreviewing
      ? 'Preview is already running'
      : actions.isRunningAll
        ? 'Wait for Run All to finish'
        : (actions.previewDisabledReason ?? 'Complete the required parameters before previewing')
    : undefined;
  const runAllDisabledReason = actions?.runAllDisabled
    ? actions.isRunningAll
      ? 'Run All is already running'
      : actions.isPreviewing
        ? 'Wait for Preview to finish'
        : (actions.runAllDisabledReason ?? 'Complete the required parameters before running')
    : undefined;
  const clearDisabledReason = actions?.clearDisabled
    ? actions.isClearing
      ? 'Results are being cleared'
      : actions.isPreviewing || actions.isRunningAll
        ? 'Stop the running analysis before clearing results'
        : (actions.clearDisabledReason ?? 'There are no results to clear')
    : undefined;
  const stopDisabled = Boolean(actions?.stopDisabled) || Boolean(actions?.isStopping);
  const stopDisabledReason = stopDisabled
    ? actions?.isStopping
      ? 'A stop request is already in progress'
      : (actions?.stopDisabledReason ?? 'This task cannot be stopped right now')
    : undefined;

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

      <fieldset disabled={parametersLocked} className="contents">
        <CardContent className="pt-0">{children}</CardContent>
      </fieldset>

      {actions ? (
        <CardFooter className="flex flex-wrap items-center gap-3 pt-0">
          {actions.onPreview ? (
            <div className="flex items-center gap-2">
              <DisabledReasonTooltip reason={previewDisabledReason}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void actions.onPreview?.();
                  }}
                  disabled={actions.previewDisabled}
                >
                  {actions.isPreviewing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {previewLabel}
                </Button>
              </DisabledReasonTooltip>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <DisabledReasonTooltip reason={runAllDisabledReason}>
              <Button
                onClick={() => {
                  void actions.onRunAll();
                }}
                disabled={actions.runAllDisabled}
                className="w-full sm:w-auto"
              >
                {actions.isRunningAll ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {runAllLabel}
              </Button>
            </DisabledReasonTooltip>
            {actions.runAllHelp ? (
              <HelpIcon
                targetKey={actions.runAllHelp.targetKey}
                label={actions.runAllHelp.label}
                tooltip={actions.runAllHelp.tooltip}
              />
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <DisabledReasonTooltip reason={clearDisabledReason}>
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
            </DisabledReasonTooltip>
            {actions.clearHelp ? (
              <HelpIcon
                targetKey={actions.clearHelp.targetKey}
                label={actions.clearHelp.label}
                tooltip={actions.clearHelp.tooltip}
              />
            ) : null}
          </div>

          {actions.onStop && (actions.isPreviewing || actions.isRunningAll) ? (
            <div className="flex items-center gap-2">
              <DisabledReasonTooltip reason={stopDisabledReason}>
                <Button
                  onClick={() => {
                    void actions.onStop?.();
                  }}
                  variant="outline"
                  disabled={stopDisabled}
                >
                  {actions.isStopping ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="mr-2 h-4 w-4" />
                  )}
                  Stop
                </Button>
              </DisabledReasonTooltip>
              {actions.stopHelp ? (
                <HelpIcon
                  targetKey={actions.stopHelp.targetKey}
                  label={actions.stopHelp.label}
                  tooltip={actions.stopHelp.tooltip}
                />
              ) : null}
            </div>
          ) : null}
        </CardFooter>
      ) : null}

      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}
