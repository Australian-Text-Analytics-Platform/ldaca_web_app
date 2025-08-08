import React, { useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useFiles } from '../hooks/useFiles';
import FileList from '../components/FileList';
import LoadButton from '../components/LoadButton';
import Modal from '../components/Modal';

interface FileLoaderTabProps {
  onFileLoaded: (filename: string) => void;
}

const FileLoaderTab: React.FC<FileLoaderTabProps> = ({ onFileLoaded }) => {
  const { isAuthenticated, getAuthHeaders } = useAuth();
  
  // Create stable auth headers object
  const authHeaders = useMemo(() => {
    return isAuthenticated ? getAuthHeaders() : undefined;
  }, [isAuthenticated, getAuthHeaders]);
  
  const {
    files,
    selectedFile,
    setSelectedFile,
    loadingFiles,
    loading,
    uploading,
    handleLoadFile,
    handleUploadFile,
    handleDeleteFile,
    handleDownloadFile
  } = useFiles({ authHeaders });

  const [showModal, setShowModal] = React.useState(false);
  const [modalMessage, setModalMessage] = React.useState('');
  const handleFileUpload = React.useCallback(async (file: File) => {
    if (!isAuthenticated) return;
    const success = await handleUploadFile(file);
    if (success) {
      setModalMessage(`File "${file.name}" uploaded successfully!`);
      setShowModal(true);
    } else {
      setModalMessage(`Failed to upload file "${file.name}". Please try again.`);
      setShowModal(true);
    }
  }, [isAuthenticated, handleUploadFile]);

  const handleLoad = async () => {
    if (!selectedFile || !isAuthenticated) return;

    const success = await handleLoadFile(selectedFile);
    if (success) {
      setModalMessage(`File "${selectedFile}" loaded successfully!`);
      setShowModal(true);
      onFileLoaded(selectedFile);
    } else {
      setModalMessage(`Failed to load file "${selectedFile}". Please try again.`);
      setShowModal(true);
    }
  };

  // handled by useCallback above

  // Local drop handlers replaced by global window handlers

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleModalClose = () => {
    setShowModal(false);
    if (modalMessage.includes('successfully')) {
      if (selectedFile) {
        onFileLoaded(selectedFile);
      }
    }
  };

  const isLoadDisabled = !selectedFile || loading || !isAuthenticated;

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">File Management</h2>
      
      {!isAuthenticated && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-amber-800">
          <div className="flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Please log in to manage files.
          </div>
        </div>
      )}

  {/* File Upload Controls */}
      {isAuthenticated && (
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Drag and drop anywhere to upload, or
              <label className="text-blue-600 hover:text-blue-700 cursor-pointer ml-1">
                browse
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileInputChange}
                  accept=".csv,.json,.parquet,.xlsx,.txt,.tsv"
                />
              </label>
            </div>
            {uploading && (
              <div className="inline-flex items-center text-sm text-blue-600">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Uploading...
              </div>
            )}
          </div>
        </div>
      )}

  {/* Drag tip removed (instructions already provided above) */}

      {/* Unified File List View as a drop target */}
      <div
        className="border border-gray-300 rounded-lg h-96 overflow-y-auto mb-4 bg-gray-50 shadow-inner"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const dropped = e.dataTransfer?.files;
          if (dropped && dropped.length) {
            for (const f of Array.from(dropped)) {
              await handleUploadFile(f);
            }
          }
        }}
      >
        <FileList
          files={files}
          selectedFile={selectedFile}
          onFileSelect={setSelectedFile}
          loading={loadingFiles}
          onDelete={isAuthenticated ? handleDeleteFile : undefined}
          onDownload={isAuthenticated ? handleDownloadFile : undefined}
        />
      </div>

      {/* Load Button */}
      <LoadButton
        onLoad={handleLoad}
        disabled={isLoadDisabled}
        loading={loading}
      />

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={handleModalClose}
        title="File Operation Status"
      >
        <p className="text-gray-700">{modalMessage}</p>
      </Modal>
    </div>
  );
};

export default FileLoaderTab;
