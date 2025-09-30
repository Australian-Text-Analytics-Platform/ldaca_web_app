import React, { useState, useEffect, useMemo } from 'react';
import columnPersistence from '../../utils/columnPersistence';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Button } from '../ui/button';

interface DocumentColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (documentColumn: string) => void;
  columns: string[];
  nodeName: string;
  workspaceId?: string | null;
  nodeId?: string | null;
  persistenceScope?: string;
}

const DocumentColumnModal: React.FC<DocumentColumnModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  columns,
  nodeName,
  workspaceId,
  nodeId,
  persistenceScope = 'document-column-modal'
}) => {
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const persistenceCtx = useMemo(() => {
    if (!workspaceId || !nodeId) return null;
    return { workspaceId, scope: persistenceScope, storage: 'session' as const };
  }, [workspaceId, nodeId, persistenceScope]);

  // Ensure modal always starts in a fresh, enabled state when (re)opened.
  // Without this, submitting could remain true after a previous confirm,
  // leaving the Convert button permanently disabled on subsequent opens.
  useEffect(() => {
    if (isOpen) {
      setSubmitting(false);
      // Do not auto-clear selectedColumn here; keep prior choice cleared already in confirm/cancel.
      // If we ever want to persist last selection across opens, remove the line below.
      // setSelectedColumn(''); // optional reset; currently confirm path already clears it.
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !persistenceCtx || !nodeId) return;
    const persisted = columnPersistence.get(persistenceCtx, nodeId);
    if (persisted) {
      setSelectedColumn(persisted);
    }
  }, [isOpen, persistenceCtx, nodeId]);

  const handleConfirm = () => {
    if (submitting) return;
    if (selectedColumn) {
      setSubmitting(true);
      onConfirm(selectedColumn);
      if (persistenceCtx && nodeId) {
        columnPersistence.set(persistenceCtx, nodeId, selectedColumn);
      }
      setSelectedColumn('');
      // Parent (CustomNode) handles closing; submitting reset handled by useEffect on reopen.
    }
  };

  const handleCancel = () => {
    setSelectedColumn('');
    setSubmitting(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert to DocDataFrame</DialogTitle>
          <DialogDescription>
            Select a column from <strong>{nodeName}</strong> to use as the document column:
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <label htmlFor="document-column" className="block text-sm font-medium mb-2">
            Document Column
          </label>
          <Select value={selectedColumn} onValueChange={setSelectedColumn}>
            <SelectTrigger id="document-column">
              <SelectValue placeholder="Select a column..." />
            </SelectTrigger>
            <SelectContent>
              {columns.map((column) => (
                <SelectItem key={column} value={column}>
                  {column}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedColumn || submitting}
          >
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DocumentColumnModal;
