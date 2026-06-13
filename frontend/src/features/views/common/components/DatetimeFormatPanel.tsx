import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { inferDatetimeFormat } from '../utils/datetimeFormatInfer';

interface DatetimeFormatPanelProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (format?: string) => void;
  columnName: string;
  sampleValues?: string[];
}

/**
 * Modal wrapper used by preprocessing flows before converting a column to
 * datetime. It keeps open/close ownership with the caller while mounting the
 * form only when the dialog is visible.
 * Why: callers need a focused rendering boundary for layout, accessibility, and state handoff.
 */
export function DatetimeFormatPanel({ open, onClose, ...contentProps }: DatetimeFormatPanelProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      {open && <DatetimeFormatPanelContent {...contentProps} onClose={onClose} />}
    </Dialog>
  );
}

/**
 * Datetime format form used inside `DatetimeFormatPanel`. It lets users accept
 * an inferred Python `strftime` format or provide one manually before the
 * preprocessing feature submits the conversion.
 * Rendered by: DatetimeFormatPanel while the conversion dialog is open because the caller needs a focused rendering boundary for layout, accessibility, and state handoff steps.
 * Flow: infer the initial format from samples, manage custom and auto-fill state, then render cancel/auto-fill/convert controls.
 */
function DatetimeFormatPanelContent({
  onClose,
  onConfirm,
  columnName,
  sampleValues = [],
}: Omit<DatetimeFormatPanelProps, 'open'>) {
  const initialFormat = sampleValues.length ? inferDatetimeFormat(sampleValues) : null;
  const [customFormat, setCustomFormat] = useState(initialFormat ?? '');
  const [autoFillTried, setAutoFillTried] = useState(sampleValues.length > 0);
  const [autoFillError, setAutoFillError] = useState<string | null>(
    sampleValues.length > 0 && !initialFormat ? 'Could not infer format' : null,
  );

  /** Called by: DatetimeFormatPanelContent Cancel button because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handleCancel = () => {
    onClose();
  };

  /** Called by: DatetimeFormatPanelContent Auto Fill button because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handleAutoFill = () => {
    setAutoFillTried(true);
    setAutoFillError(null);
    const inferred = inferDatetimeFormat(sampleValues);
    if (inferred) {
      setCustomFormat(inferred);
    } else {
      setAutoFillError('Could not infer format');
    }
  };

  /** Called by: DatetimeFormatPanelContent Convert button because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handleConfirm = () => {
    const trimmed = customFormat.trim();
    onConfirm(trimmed.length ? trimmed : undefined);
    onClose();
  };

  return (
    <DialogContent className="w-full max-w-lg border-none bg-transparent p-0 shadow-none">
      <DialogHeader className="sr-only">
        <DialogTitle>Convert {columnName || 'column'} to datetime</DialogTitle>
        <DialogDescription>
          Provide a strftime format or let Auto Fill guess it from sample values.
        </DialogDescription>
      </DialogHeader>
      <Card>
        <CardHeader>
          <CardTitle>
            Convert <span className="text-muted-foreground">&ldquo;{columnName}&rdquo;</span> to
            Datetime
          </CardTitle>
          <CardDescription>
            Provide a strftime format or let Auto Fill guess it from sample values.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Custom format</span>
              <Button
                type="button"
                onClick={handleAutoFill}
                variant="outline"
                size="sm"
                className="h-7 px-2"
              >
                Auto Fill
              </Button>
            </div>
            <input
              type="text"
              placeholder="e.g., %Y-%m-%d %H:%M:%S"
              value={customFormat}
              onChange={(event) => { setCustomFormat(event.target.value); }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="mt-1 text-xs text-muted-foreground">
              Use Python strftime codes.
              {autoFillTried && autoFillError && (
                <span className="ml-1 text-destructive">{autoFillError}</span>
              )}
              {autoFillTried && !autoFillError && customFormat && (
                <span className="ml-1 text-green-600">Inferred.</span>
              )}
            </div>
          </div>
        </CardContent>

        <CardFooter className="border-t border-border/70 pt-4">
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="outline" onClick={handleCancel} type="button">
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Convert</Button>
          </div>
        </CardFooter>
      </Card>
    </DialogContent>
  );
}
