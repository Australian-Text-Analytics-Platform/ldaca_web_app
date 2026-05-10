import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { NodeSchemaResponse } from '@/types';

import { extractColumnTypes, normalizeTypeName } from '../services/schemaMutations';

interface DatetimeModalState {
  isOpen: boolean;
  column: string;
  targetType: string;
}

interface UseColumnMutationsArgs {
  workspaceId: string | undefined;
  nodeId: string | undefined;
  /** Current visible column names (used for duplicate-rename validation). */
  columns: string[];
  onCast?: (column: string, targetType: string, format?: string) => Promise<void>;
  onRenameColumn?: (column: string, nextName: string) => Promise<void>;
  onDeleteColumn?: (column: string) => Promise<void>;
  /** Returns the latest node schema; called once on mount and after every mutation. */
  onRefreshSchema?: () => Promise<unknown>;
}

export interface ColumnMutationsApi {
  // Read state
  columnTypes: Record<string, string>;
  loadingCast: Record<string, boolean>;
  columnActionLoading: Record<string, boolean>;
  renamingColumn: string | null;

  // Datetime confirmation modal (string→datetime needs a format)
  datetimeModal: DatetimeModalState;
  closeDatetimeModal: () => void;
  handleDatetimeFormatConfirm: (format?: string) => void;

  // Delete-column confirm dialog
  deleteColumnDialogOpen: boolean;
  setDeleteColumnDialogOpen: (open: boolean) => void;
  columnToDelete: string | null;
  requestDeleteColumn: (column: string) => void;
  confirmDeleteColumn: () => Promise<void>;

  // Per-column actions
  handleTypeChange: (column: string, newType: string) => void;
  startRename: (column: string) => void;
  cancelRename: () => void;
  submitRename: (column: string, value: string) => Promise<void>;
}

/**
 * Owns every piece of state that lives inside a WorkspaceTable column header
 * (data-type cast / rename / delete / per-column busy state) plus the schema
 * bootstrap effect. Keeps WorkspaceTable.tsx focused on rendering. Behaviour
 * preserved exactly; toasts and error messages unchanged.
 */
export const useColumnMutations = ({
  workspaceId,
  nodeId,
  columns,
  onCast,
  onRenameColumn,
  onDeleteColumn,
  onRefreshSchema,
}: UseColumnMutationsArgs): ColumnMutationsApi => {
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [loadingCast, setLoadingCast] = useState<Record<string, boolean>>({});
  const [datetimeModal, setDatetimeModal] = useState<DatetimeModalState>({
    isOpen: false,
    column: '',
    targetType: '',
  });
  const [columnActionLoading, setColumnActionLoading] = useState<Record<string, boolean>>({});
  const [renamingColumn, setRenamingColumn] = useState<string | null>(null);
  const [deleteColumnDialogOpen, setDeleteColumnDialogOpen] = useState(false);
  const [columnToDelete, setColumnToDelete] = useState<string | null>(null);

  const applySchema = useCallback((schema: unknown) => {
    const mapping = extractColumnTypes(schema as NodeSchemaResponse | null);
    setColumnTypes(mapping);
    return mapping;
  }, []);

  // Bootstrap on workspace/node change.
  useEffect(() => {
    if (!workspaceId || !nodeId || !onRefreshSchema) return;
    let cancelled = false;
    onRefreshSchema()
      .then((schema) => { if (!cancelled) applySchema(schema); })
      .catch((error) => { if (!cancelled) console.error('useColumnMutations: failed to refresh schema', error); });
    return () => { cancelled = true; };
  }, [workspaceId, nodeId, onRefreshSchema, applySchema]);

  const setColumnBusy = useCallback((column: string, active: boolean) => {
    setColumnActionLoading((prev) => {
      if (active) return prev[column] ? prev : { ...prev, [column]: true };
      if (!(column in prev)) return prev;
      const { [column]: _, ...next } = prev;
      return next;
    });
  }, []);

  const performCast = useCallback(async (column: string, targetType: string, format?: string) => {
    if (!onCast) return;
    setLoadingCast((prev) => ({ ...prev, [column]: true }));
    try {
      await onCast(column, targetType, format);
      if (onRefreshSchema) {
        const schema = await onRefreshSchema();
        applySchema(schema);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to convert column "${column}" to ${targetType}: ${message}`);
    } finally {
      setLoadingCast((prev) => ({ ...prev, [column]: false }));
    }
  }, [onCast, onRefreshSchema, applySchema]);

  const handleTypeChange = useCallback((column: string, newType: string) => {
    if (!onCast) return;
    const currentType = normalizeTypeName(columnTypes[column] ?? 'string');
    if (newType.toLowerCase() === currentType.toLowerCase()) return;
    const isStringToDatetime =
      newType.toLowerCase() === 'datetime'
      && (currentType === 'string' || currentType.includes('utf8'));
    if (isStringToDatetime) {
      setDatetimeModal({ isOpen: true, column, targetType: newType });
      return;
    }
    void performCast(column, newType);
  }, [onCast, columnTypes, performCast]);

  const handleDatetimeFormatConfirm = useCallback((format?: string) => {
    const { column, targetType } = datetimeModal;
    setDatetimeModal({ isOpen: false, column: '', targetType: '' });
    if (column && targetType) void performCast(column, targetType, format);
  }, [datetimeModal, performCast]);

  const closeDatetimeModal = useCallback(() => {
    setDatetimeModal({ isOpen: false, column: '', targetType: '' });
  }, []);

  const startRename = useCallback((column: string) => {
    setRenamingColumn(column);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingColumn(null);
  }, []);

  const submitRename = useCallback(async (column: string, value: string) => {
    if (!onRenameColumn) {
      setRenamingColumn(null);
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) { toast.error('Column name cannot be empty.'); return; }
    if (trimmed === column) { setRenamingColumn(null); return; }
    if (columns.some((c) => c !== column && c === trimmed)) {
      toast.error(`A column named "${trimmed}" already exists.`);
      return;
    }
    setColumnBusy(column, true);
    try {
      await onRenameColumn(column, trimmed);
      if (onRefreshSchema) {
        const schema = await onRefreshSchema();
        applySchema(schema);
      }
      setRenamingColumn(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to rename column "${column}": ${message}`);
    } finally {
      setColumnBusy(column, false);
    }
  }, [onRenameColumn, columns, setColumnBusy, onRefreshSchema, applySchema]);

  const requestDeleteColumn = useCallback((column: string) => {
    setColumnToDelete(column);
    setDeleteColumnDialogOpen(true);
  }, []);

  const confirmDeleteColumn = useCallback(async () => {
    if (!columnToDelete || !onDeleteColumn) return;
    const column = columnToDelete;
    setDeleteColumnDialogOpen(false);
    setColumnToDelete(null);
    setColumnBusy(column, true);
    try {
      await onDeleteColumn(column);
      if (onRefreshSchema) {
        const schema = await onRefreshSchema();
        applySchema(schema);
      } else {
        setColumnTypes((prev) => {
          if (!(column in prev)) return prev;
          const { [column]: _, ...next } = prev;
          return next;
        });
      }
      setRenamingColumn((prev) => (prev === column ? null : prev));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to delete column "${column}": ${message}`);
    } finally {
      setColumnBusy(column, false);
    }
  }, [columnToDelete, onDeleteColumn, setColumnBusy, onRefreshSchema, applySchema]);

  return {
    columnTypes,
    loadingCast,
    columnActionLoading,
    renamingColumn,
    datetimeModal,
    closeDatetimeModal,
    handleDatetimeFormatConfirm,
    deleteColumnDialogOpen,
    setDeleteColumnDialogOpen,
    columnToDelete,
    requestDeleteColumn,
    confirmDeleteColumn,
    handleTypeChange,
    startRename,
    cancelRename,
    submitRename,
  };
};
