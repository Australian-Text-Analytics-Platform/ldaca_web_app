import React, { useEffect, useMemo, useState } from 'react';
import columnPersistence from '../../utils/columnPersistence';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../ui/sheet';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface DocumentColumnPanelProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (documentColumn: string) => void;
  columns: string[];
  nodeName: string;
  workspaceId?: string | null;
  nodeId?: string | null;
  persistenceScope?: string;
}

export const DocumentColumnPanel: React.FC<DocumentColumnPanelProps> = ({
  open,
  onClose,
  onConfirm,
  columns,
  nodeName,
  workspaceId,
  nodeId,
  persistenceScope = 'document-column-panel'
}) => {
  const [selectedColumn, setSelectedColumn] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const persistenceCtx = useMemo(() => {
    if (!workspaceId || !nodeId) return null;
    return { workspaceId, scope: persistenceScope, storage: 'session' as const };
  }, [workspaceId, nodeId, persistenceScope]);

  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    if (!persistenceCtx || !nodeId) {
      setSelectedColumn('');
      return;
    }
    const persisted = columnPersistence.get(persistenceCtx, nodeId);
    if (persisted) {
      setSelectedColumn(persisted);
    }
  }, [open, persistenceCtx, nodeId]);

  const handleCancel = () => {
    setSelectedColumn('');
    setSubmitting(false);
    onClose();
  };

  const handleConfirm = () => {
    if (!selectedColumn || submitting) return;
    setSubmitting(true);
    onConfirm(selectedColumn);
    if (persistenceCtx && nodeId) {
      columnPersistence.set(persistenceCtx, nodeId, selectedColumn);
    }
    setSelectedColumn('');
    setSubmitting(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel();
        }
      }}
    >
      <SheetContent side="right" className="sm:max-w-md w-full">
        <SheetHeader>
          <SheetTitle>Choose a document column</SheetTitle>
          <SheetDescription>
            Select which column from <span className="font-semibold text-foreground">{nodeName}</span> should be treated as the document text.
          </SheetDescription>
        </SheetHeader>

        <div className="py-4">
          <label htmlFor="document-column" className="mb-2 block text-sm font-medium text-foreground">
            Document Column
          </label>
          <Select value={selectedColumn} onValueChange={setSelectedColumn}>
            <SelectTrigger id="document-column">
              <SelectValue placeholder="Select a column" />
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

        <SheetFooter className="border-t border-border/70 pt-4">
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="outline" onClick={handleCancel} type="button">
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={!selectedColumn || submitting}>
              Convert
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default DocumentColumnPanel;
