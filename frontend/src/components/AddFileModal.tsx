import React, { useEffect, useMemo, useState } from 'react';
import { useFilePreview } from '../hooks/useFilePreview';

interface AddFileModalProps {
  filename: string | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (opts: { mode: 'corpus' | 'metadata'; documentColumn?: string | null }) => Promise<void> | void;
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
  const { previewData, columns, fetchPreview, clearPreview, loading, error } = useFilePreview();
  const [mode, setMode] = useState<'corpus' | 'metadata'>('corpus');
  const [documentColumn, setDocumentColumn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const guessed = useMemo(() => guessDocumentColumn(columns, previewData) , [columns, previewData]);

  useEffect(() => {
    if (isOpen && filename) {
      fetchPreview(filename, 0);
    } else {
      clearPreview();
      setMode('corpus');
      setDocumentColumn(null);
    }
  }, [isOpen, filename, fetchPreview, clearPreview]);

  useEffect(() => {
    if (mode === 'corpus') {
      setDocumentColumn(prev => prev || guessed || null);
    } else {
      setDocumentColumn(null);
    }
  }, [mode, guessed]);

  if (!isOpen || !filename) return null;

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      await onConfirm({ mode, documentColumn: mode === 'corpus' ? documentColumn || undefined : undefined });
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
            <div className="flex space-x-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input type="radio" name="add-mode" value="corpus" checked={mode==='corpus'} onChange={() => setMode('corpus')} />
                <span className="text-sm font-medium">Add as DocLazyFrame</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input type="radio" name="add-mode" value="metadata" checked={mode==='metadata'} onChange={() => setMode('metadata')} />
                <span className="text-sm font-medium">Add as LazyFrame</span>
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-500">DocLazyFrame mode enables text-aware operations. LazyFrame adds the data without text semantics.</p>
          </div>

          {mode === 'corpus' && (
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
                  <option value="">{guessed ? `Auto (${guessed})` : 'Auto-detect'}</option>
                  {columns.map(c => (
                    <option key={c} value={c}>{c}{c===guessed ? ' (guessed)' : ''}</option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-xs text-gray-500">Leave as Auto to let backend guess using column heuristics.</p>
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
