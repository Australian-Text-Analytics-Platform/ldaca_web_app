import React, { useState, useRef } from 'react';
import { useFilePreview } from '../hooks/useFilePreview';
import FilePreviewTooltip from './FilePreviewTooltip';
import { FileInfo } from '../types';

interface FileListProps {
  files: FileInfo[];
  selectedFile: string | null;
  onFileSelect: (file: string) => void;
  loading: boolean;
  onDelete?: (filename: string) => Promise<boolean>;
  onDownload?: (filename: string) => Promise<boolean>;
}

const FileList: React.FC<FileListProps> = ({ 
  files, 
  selectedFile, 
  onFileSelect, 
  loading,
  onDelete,
  onDownload
}) => {
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [actionLoading, setActionLoading] = useState<{ [key: string]: 'delete' | 'download' | null }>({});
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { previewData, loading: previewLoading, error, fetchPreview, clearPreview } = useFilePreview();

  const handleMouseEnter = (filename: string, event: React.MouseEvent) => {
    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // Set tooltip position
    setTooltipPosition({ x: event.clientX, y: event.clientY });
    setHoveredFile(filename);

    // Delay before showing tooltip and fetching preview
    hoverTimeoutRef.current = setTimeout(() => {
      fetchPreview(filename);
    }, 500); // 500ms delay before showing preview
  };

  const handleMouseLeave = () => {
    // Clear timeout and hide tooltip
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredFile(null);
    clearPreview();
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (hoveredFile) {
      setTooltipPosition({ x: event.clientX, y: event.clientY });
    }
  };

  const handleDelete = async (filename: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!onDelete) return;

    if (window.confirm(`Are you sure you want to delete "${filename}"?`)) {
      setActionLoading(prev => ({ ...prev, [filename]: 'delete' }));
      try {
        await onDelete(filename);
      } finally {
        setActionLoading(prev => ({ ...prev, [filename]: null }));
      }
    }
  };

  const handleDownload = async (filename: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!onDownload) return;

    setActionLoading(prev => ({ ...prev, [filename]: 'download' }));
    try {
      await onDownload(filename);
    } finally {
      setActionLoading(prev => ({ ...prev, [filename]: null }));
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const getFileIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'csv':
        return (
          <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        );
      case 'json':
        return (
          <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'xlsx':
      case 'xls':
        return (
          <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clipRule="evenodd" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="flex items-center justify-center space-x-2">
          <svg className="animate-spin h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-gray-600">Loading files...</span>
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 48 48">
          <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p>No files found</p>
        <p className="text-sm text-gray-400">Upload a file to get started</p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {files.map((file) => (
          <li
            key={file.filename}
            className={`p-3 cursor-pointer transition-all duration-200 hover:bg-blue-50 ${
              selectedFile === file.filename 
                ? 'bg-blue-100 border-l-4 border-blue-500' 
                : 'hover:text-blue-700'
            }`}
            onClick={() => onFileSelect(file.filename)}
            onMouseEnter={(e) => handleMouseEnter(file.filename, e)}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                {getFileIcon(file.file_type || file.type || 'unknown')}
                <div className="min-w-0 flex-1">
                  <div className={`font-medium truncate ${
                    selectedFile === file.filename ? 'text-blue-800' : 'text-gray-700'
                  }`}>
                    {file.full_path || file.filename}
                  </div>
                  {(file.folder || file.display_name) && (
                    <div className="text-[11px] text-gray-400 truncate">
                      {file.folder ? `${file.folder}/` : ''}{file.display_name || ''}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 flex items-center space-x-2">
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <span>{formatDate(String(file.created_at || file.modified || ''))}</span>
                    <span>•</span>
                    <span className="uppercase">{file.file_type || file.type || 'unknown'}</span>
                    {typeof file.is_sample !== 'undefined' && (
                      <>
                        <span>•</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${file.is_sample ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {file.is_sample ? 'SAMPLE' : 'USER'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              {(onDownload || onDelete) && (
                <div className="flex items-center space-x-1 ml-2">
                  {onDownload && (
                    <button
                      onClick={(e) => handleDownload(file.filename, e)}
                      disabled={!!actionLoading[file.filename]}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="Download"
                    >
                      {actionLoading[file.filename] === 'download' ? (
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                    </button>
                  )}
                  
                  {onDelete && (
                    <button
                      onClick={(e) => handleDelete(file.filename, e)}
                      disabled={!!actionLoading[file.filename]}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Delete"
                    >
                      {actionLoading[file.filename] === 'delete' ? (
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      
      <FilePreviewTooltip
        previewData={previewData}
        loading={previewLoading}
        error={error}
        visible={!!hoveredFile}
        position={tooltipPosition}
      />
    </>
  );
};

export default FileList;
