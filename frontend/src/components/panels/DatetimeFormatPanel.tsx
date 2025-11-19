import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
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

  const resetForm = useCallback(() => {
    setCustomFormat('');
    setAutoFillTried(false);
    setAutoFillError(null);
  }, []);

  const handleCancel = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleAutoFill = useCallback(async () => {
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
  }, [sampleValues]);

  useEffect(() => {
    if (open && sampleValues.length > 0 && !autoFillTried) {
      handleAutoFill();
    }
  }, [open, sampleValues, autoFillTried, handleAutoFill]);

  const handleConfirm = useCallback(() => {
    onConfirm(customFormat || undefined);
    resetForm();
  }, [customFormat, onConfirm, resetForm]);

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
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
