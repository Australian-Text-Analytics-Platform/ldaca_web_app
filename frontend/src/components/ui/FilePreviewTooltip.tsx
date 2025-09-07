import React from 'react';

interface FilePreviewTooltipProps {
  previewData: any[];
  loading: boolean;
  error: string | null;
  visible: boolean;
  position: { x: number; y: number };
}

const FilePreviewTooltip: React.FC<FilePreviewTooltipProps> = ({
  previewData,
  loading,
  error,
  visible,
  position
}) => {
  if (!visible) return null;

  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x + 10,
    top: position.y + 10,
    zIndex: 1000,
    maxWidth: 600,
    maxHeight: 400,
    fontSize: 12
  };

  if (loading) {
    return (
      <div 
        style={tooltipStyle} 
        className="bg-white border border-gray-200 rounded-lg shadow-xl p-4"
      >
        <div className="flex items-center justify-center space-x-2">
          <svg className="animate-spin h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-gray-600">Loading preview...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div 
        style={tooltipStyle} 
        className="bg-white border border-red-200 rounded-lg shadow-xl p-4"
      >
        <div className="flex items-center space-x-2 text-red-600">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!previewData || previewData.length === 0) {
    return (
      <div 
        style={tooltipStyle} 
        className="bg-white border border-gray-200 rounded-lg shadow-xl p-4"
      >
        <div className="text-gray-500 text-center">
          No preview available
        </div>
      </div>
    );
  }

  const columns = Object.keys(previewData[0]);

  return (
    <div 
      style={tooltipStyle} 
      className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
    >
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="font-semibold text-gray-800 text-sm">
            File Preview ({previewData.length} rows)
          </span>
        </div>
      </div>
      <div className="overflow-auto max-h-80">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className="border-r border-gray-200 last:border-r-0 px-2 py-1 text-left font-medium text-gray-700 max-w-24 truncate"
                  title={col}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {previewData.slice(0, 10).map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-gray-50">
                {columns.map((col, colIdx) => (
                  <td
                    key={colIdx}
                    className="border-r border-gray-100 last:border-r-0 px-2 py-1 max-w-24 truncate text-gray-900"
                    title={String(row[col] || '')}
                  >
                    {String(row[col] || '').substring(0, 20)}
                    {String(row[col] || '').length > 20 ? '...' : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {previewData.length > 10 && (
        <div className="bg-gray-50 px-4 py-2 border-t border-gray-200">
          <div className="text-xs text-gray-600 text-center">
            ... and {previewData.length - 10} more rows
          </div>
        </div>
      )}
    </div>
  );
};

export default FilePreviewTooltip;
