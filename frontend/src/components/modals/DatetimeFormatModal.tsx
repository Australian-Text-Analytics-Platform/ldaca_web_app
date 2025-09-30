import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';

interface DatetimeFormatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (format?: string) => void;
  columnName: string;
  sampleValues?: string[]; // preview values used for auto fill inference
}

const DatetimeFormatModal: React.FC<DatetimeFormatModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  columnName,
  sampleValues = []
}) => {
  const [customFormat, setCustomFormat] = useState('');
  const [autoFillTried, setAutoFillTried] = useState(false);
  const [autoFillError, setAutoFillError] = useState<string | null>(null);

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
    } catch (e) {
      setAutoFillError('Inference error');
    }
  }, [sampleValues]);

  // Auto-fill when modal opens
  useEffect(() => {
    if (isOpen && sampleValues.length > 0 && !autoFillTried) {
      handleAutoFill();
    }
  }, [isOpen, sampleValues.length, autoFillTried, handleAutoFill]);

  const handleConfirm = () => {
    onConfirm(customFormat || undefined);
    resetForm();
  };

  const handleCancel = () => {
    onClose();
    resetForm();
  };

  const resetForm = () => {
    setCustomFormat('');
    setAutoFillTried(false);
    setAutoFillError(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert "{columnName}" to Datetime</DialogTitle>
          <DialogDescription>
            Provide a custom strftime format. Use Auto Fill to guess from sample values.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-foreground">Custom format</div>
              <Button
                type="button"
                onClick={handleAutoFill}
                variant="outline"
                size="sm"
                className="h-7 px-2"
              >Auto Fill</Button>
            </div>
            <input
              type="text"
              placeholder="e.g., %Y-%m-%d %H:%M:%S"
              value={customFormat}
              onChange={(e) => setCustomFormat(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="mt-1 text-xs text-muted-foreground">
              Use Python strftime codes.
              {autoFillTried && autoFillError && <span className="ml-1 text-destructive">{autoFillError}</span>}
              {autoFillTried && !autoFillError && customFormat && <span className="ml-1 text-green-600">Inferred.</span>}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DatetimeFormatModal;
