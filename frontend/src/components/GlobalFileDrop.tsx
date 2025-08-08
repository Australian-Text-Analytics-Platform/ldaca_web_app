import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { useFiles } from '../hooks/useFiles';

const GlobalFileDrop: React.FC = () => {
  const { isAuthenticated, requiresAuthentication, getAuthHeaders } = useAuth();
  // In single-user mode, uploads require no auth headers
  const authHeaders = React.useMemo(() => (requiresAuthentication ? getAuthHeaders() : {}), [requiresAuthentication, getAuthHeaders]);
  const { handleUploadFile, uploading } = useFiles({ authHeaders });

  const [dragOver, setDragOver] = React.useState(false);

  const handleUpload = React.useCallback(async (files: FileList) => {
  // Allow uploads if auth isn't required or if user is authenticated
  if (requiresAuthentication && !isAuthenticated) return;
    for (const file of Array.from(files)) {
      await handleUploadFile(file);
    }
  }, [isAuthenticated, requiresAuthentication, handleUploadFile]);

  React.useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
  if (!requiresAuthentication || isAuthenticated) setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
  if (requiresAuthentication && !isAuthenticated) return;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleUpload(e.dataTransfer.files);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [isAuthenticated, requiresAuthentication, handleUpload]);

  if (requiresAuthentication && !isAuthenticated) return null;

  return (
    <>
      {dragOver && (
        <div className="fixed inset-0 z-[999] pointer-events-none">
          <div className="absolute inset-0 bg-blue-50/60 border-2 border-dashed border-blue-300"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-white/90 backdrop-blur-sm rounded-lg px-6 py-4 shadow border border-blue-200">
              <div className="flex items-center space-x-2 text-blue-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l-4-4m4 4l4-4" />
                </svg>
                <span className="font-medium">Drop files to upload</span>
                {uploading && (
                  <span className="ml-2 text-sm">Uploading…</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GlobalFileDrop;
