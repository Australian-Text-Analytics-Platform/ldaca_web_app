import React, { useEffect, useMemo, useState } from 'react';
import { useFilePreview } from '../../hooks/useFilePreview';
import columnPersistence from '../../utils/columnPersistence';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import {
  Dialog,
  DialogContent,
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
import { Separator } from '../ui/separator';

interface AddFileModalProps {
  filename: string | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (opts: { mode: 'DocLazyFrame' | 'LazyFrame' | 'DocDataFrame' | 'DataFrame'; documentColumn?: string | null }) => Promise<void> | void;
}

// Heuristic guess replicating backend (average length of string columns in preview slice)
function guessDocumentColumn(columns: string[], rows: any[]): string | null {
  if (!columns.length || !rows.length) return null;
  const stringCols = columns.filter(col => rows.some(r => typeof r[col] === 'string' && r[col] !== 'None'));
  if (!stringCols.length) return null;
  if (stringCols.length === 1) return stringCols[0];
  const averages: Record<string, number> = {};
  stringCols.forEach(col => {
    let total = 0; let count = 0;
    rows.forEach(r => { const v = r[col]; if (typeof v === 'string') { total += v.length; count++; } });
    averages[col] = count ? total / count : 0;
  });
  return stringCols.sort((a,b) => (averages[b] - averages[a]))[0];
}

const AddFileModal: React.FC<AddFileModalProps> = ({ filename, isOpen, onClose, onConfirm }) => {
  const { currentWorkspaceId } = useWorkspaceData() as any;
  const {
    previewData,
    columns,
    fetchPreview,
    clearPreview,
    loading,
    error,
    fileType,
    supportedTypes,
    sheetNames,
    selectedSheet,
    setSelectedSheet,
  } = useFilePreview();
  const [mode, setMode] = useState<'DocLazyFrame' | 'LazyFrame' | 'DocDataFrame' | 'DataFrame'>('DocLazyFrame');
  const [documentColumn, setDocumentColumn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const guessed = useMemo(() => guessDocumentColumn(columns, previewData) , [columns, previewData]);
  const filePersistenceCtx = useMemo(() => ({
    workspaceId: currentWorkspaceId ?? null,
    scope: 'add-file-modal',
    storage: 'local' as const,
  }), [currentWorkspaceId]);
  const persistedDocumentColumn = useMemo(() => {
    if (!filename) return null;
    return columnPersistence.get(filePersistenceCtx, filename);
  }, [filePersistenceCtx, filename]);

  useEffect(() => {
    if (isOpen && filename) {
  fetchPreview(filename, 0);
    } else {
      clearPreview();
  setMode('DocLazyFrame');
      setDocumentColumn(null);
    }
  }, [isOpen, filename, fetchPreview, clearPreview]);

  // When supported types arrive, pick a sensible default if current mode isn't supported
  useEffect(() => {
    if (!supportedTypes || supportedTypes.length === 0) return;
    if (!supportedTypes.includes(mode)) {
      setMode(supportedTypes[0] as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportedTypes, mode]);

  useEffect(() => {
  if (mode === 'DocLazyFrame' || mode === 'DocDataFrame') {
      setDocumentColumn(prev => prev || persistedDocumentColumn || guessed || null);
    } else {
      setDocumentColumn(null);
    }
  }, [mode, guessed, persistedDocumentColumn]);

  if (!isOpen || !filename) return null;

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
  await onConfirm({ mode, documentColumn: (mode === 'DocLazyFrame' || mode === 'DocDataFrame') ? documentColumn || undefined : undefined });
      if ((mode === 'DocLazyFrame' || mode === 'DocDataFrame') && filename && documentColumn) {
        columnPersistence.set(filePersistenceCtx, filename, documentColumn);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate">Add File: {filename}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 overflow-auto px-1">
          {/* File info and supported types removed per request */}

          {/* Excel sheet picker */}
          {fileType === 'excel' && sheetNames && sheetNames.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">Sheet</label>
              <Select
                value={selectedSheet || ''}
                onValueChange={(value) => {
                  const next = value || null;
                  setSelectedSheet(next);
                  // refresh preview for the chosen sheet
                  fetchPreview(filename, 0, { sheetName: next || undefined });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sheetNames.map(n => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">First sheet is selected by default. Pick another to update the preview.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Mode</label>
            <div className="grid grid-cols-4 gap-2 w-full">
              {(supportedTypes?.length ? supportedTypes : ['DocLazyFrame','LazyFrame']).map(t => (
                <label
                  key={t}
                  className="w-full flex items-center justify-center gap-2 cursor-pointer p-2 border rounded hover:bg-accent"
                >
                  <input type="radio" name="add-mode" value={t} checked={mode===t as any} onChange={() => setMode(t as any)} />
                  <span className="text-sm font-medium">{t}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Doc* modes enable text-aware operations; plain modes add data without text semantics.</p>
          </div>

          {(mode === 'DocLazyFrame' || mode === 'DocDataFrame') && (
            <div>
              <label className="block text-sm font-medium mb-2">Text / document column</label>
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading preview…</div>
              ) : error ? (
                <div className="text-sm text-destructive">{error}</div>
              ) : (
                <Select
                  value={documentColumn || ''}
                  onValueChange={(value) => setDocumentColumn(value || null)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map(c => (
                      <SelectItem key={c} value={c}>{c}{c===guessed ? ' (guessed)' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="mt-1 text-xs text-muted-foreground">A preferred column is pre-selected automatically; change it if needed.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Preview (first rows)</label>
            <div className="border rounded overflow-auto max-h-60">
              {loading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading…</div>
              ) : previewData.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No preview</div>
              ) : (
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-muted">{columns.map(c => <th key={c} className="px-2 py-1 text-left font-medium">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {previewData.slice(0,10).map((row,i) => (
                      <tr key={i} className={i%2? 'bg-muted/50':'bg-background'}>
                        {columns.map(c => <td key={c} className="px-2 py-1 whitespace-nowrap max-w-[12rem] truncate" title={String(row[c] ?? '')}>{String(row[c] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
        
        <Separator />
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting}
          >{submitting ? 'Adding…' : 'Add to Workspace'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddFileModal;
