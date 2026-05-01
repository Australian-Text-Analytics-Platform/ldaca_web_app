import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';

interface DatetimeFormatPanelProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (format?: string) => void;
  columnName: string;
  sampleValues?: string[];
}

export const DatetimeFormatPanel: React.FC<DatetimeFormatPanelProps> = ({
  open,
  onClose,
  onConfirm,
  columnName,
  sampleValues = []
}) => {
  const [customFormat, setCustomFormat] = useState('');
  const [autoFillTried, setAutoFillTried] = useState(false);
  const [autoFillError, setAutoFillError] = useState<string | null>(null);

  const resetForm = () => {
    setCustomFormat('');
    setAutoFillTried(false);
    setAutoFillError(null);
  };

  const handleCancel = () => {
    resetForm();
    onClose();
  };

  const handleAutoFill = async () => {
    setAutoFillTried(true);
    setAutoFillError(null);
    try {
      const { inferDatetimeFormat } = await import('../../utils/datetimeFormatInfer');
      const inferred = inferDatetimeFormat(sampleValues || []);
      if (inferred) {
        setCustomFormat(inferred);
      } else {
        setAutoFillError('Could not infer format');
      }
    } catch {
      setAutoFillError('Inference error');
    }
  };

  useEffect(() => {
    if (open && sampleValues.length && !autoFillTried) {
      void handleAutoFill();
    }
    if (!open) {
      resetForm();
    }
    // handleAutoFill is intentionally excluded — it's an event handler whose identity changes every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sampleValues, autoFillTried]);

  const handleConfirm = () => {
    const trimmed = customFormat.trim();
    onConfirm(trimmed.length ? trimmed : undefined);
    resetForm();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel();
        }
      }}
    >
      <DialogContent className="w-full max-w-lg border-none bg-transparent p-0 shadow-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Convert {columnName || 'column'} to datetime</DialogTitle>
          <DialogDescription>Provide a strftime format or let Auto Fill guess it from sample values.</DialogDescription>
        </DialogHeader>
        <Card>
          <CardHeader>
            <CardTitle>
              Convert <span className="text-muted-foreground">&ldquo;{columnName}&rdquo;</span> to Datetime
            </CardTitle>
            <CardDescription>Provide a strftime format or let Auto Fill guess it from sample values.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Custom format</span>
                <Button type="button" onClick={handleAutoFill} variant="outline" size="sm" className="h-7 px-2">
                  Auto Fill
                </Button>
              </div>
              <input
                type="text"
                placeholder="e.g., %Y-%m-%d %H:%M:%S"
                value={customFormat}
                onChange={(event) => setCustomFormat(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                Use Python strftime codes.
                {autoFillTried && autoFillError && <span className="ml-1 text-destructive">{autoFillError}</span>}
                {autoFillTried && !autoFillError && customFormat && <span className="ml-1 text-green-600">Inferred.</span>}
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
    </Dialog>
  );
};

export default DatetimeFormatPanel;