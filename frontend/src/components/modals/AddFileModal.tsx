import React, { useEffect, useMemo, useState } from 'react';
import { useFilePreview } from '../../hooks/useFilePreview';
import columnPersistence from '../../utils/columnPersistence';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-800 truncate">Add File: {filename}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <div className="p-5 space-y-6 overflow-auto">
          {/* File info and supported types removed per request */}

          {/* Excel sheet picker */}
          {fileType === 'excel' && sheetNames && sheetNames.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sheet</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={selectedSheet || ''}
                onChange={e => {
                  const next = e.target.value || null;
                  setSelectedSheet(next);
                  // refresh preview for the chosen sheet
                  fetchPreview(filename, 0, { sheetName: next || undefined });
                }}
              >
                {sheetNames.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">First sheet is selected by default. Pick another to update the preview.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
            <div className="grid grid-cols-4 gap-2 w-full">
              {(supportedTypes?.length ? supportedTypes : ['DocLazyFrame','LazyFrame']).map(t => (
                <label
                  key={t}
                  className="w-full flex items-center justify-center gap-2 cursor-pointer p-2 border rounded hover:bg-gray-50"
                >
                  <input type="radio" name="add-mode" value={t} checked={mode===t as any} onChange={() => setMode(t as any)} />
                  <span className="text-sm font-medium">{t}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">Doc* modes enable text-aware operations; plain modes add data without text semantics.</p>
          </div>

          {(mode === 'DocLazyFrame' || mode === 'DocDataFrame') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Text / document column</label>
              {loading ? (
                <div className="text-sm text-gray-500">Loading preview…</div>
              ) : error ? (
                <div className="text-sm text-red-600">{error}</div>
              ) : (
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={documentColumn || ''}
                  onChange={e => setDocumentColumn(e.target.value || null)}
                >
                  {columns.map(c => (
                    <option key={c} value={c}>{c}{c===guessed ? ' (guessed)' : ''}</option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-xs text-gray-500">A preferred column is pre-selected automatically; change it if needed.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Preview (first rows)</label>
            <div className="border rounded overflow-auto max-h-60">
              {loading ? (
                <div className="p-4 text-sm text-gray-500">Loading…</div>
              ) : previewData.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">No preview</div>
              ) : (
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">{columns.map(c => <th key={c} className="px-2 py-1 text-left font-medium">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {previewData.slice(0,10).map((row,i) => (
                      <tr key={i} className={i%2? 'bg-gray-50':'bg-white'}>
                        {columns.map(c => <td key={c} className="px-2 py-1 whitespace-nowrap max-w-[12rem] truncate" title={String(row[c] ?? '')}>{String(row[c] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end space-x-3 px-5 py-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border bg-white hover:bg-gray-100">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >{submitting ? 'Adding…' : 'Add to Workspace'}</button>
        </div>
      </div>
    </div>
  );
};

export default AddFileModal;
