import React, { useState } from 'react';

interface DocumentColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (documentColumn: string) => void;
  columns: string[];
  nodeName: string;
}

const DocumentColumnModal: React.FC<DocumentColumnModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  columns,
  nodeName
}) => {
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const handleConfirm = () => {
    if (submitting) return;
    if (selectedColumn) {
      setSubmitting(true);
      onConfirm(selectedColumn);
      setSelectedColumn('');
      // Parent (CustomNode) handles closing the modal after confirm
    }
  };

  const handleCancel = () => {
  setSelectedColumn('');
  setSubmitting(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 max-w-md mx-4">
        <h3 className="text-lg font-medium text-gray-800 mb-4">
          Convert to DocDataFrame
        </h3>
        
        <p className="text-sm text-gray-600 mb-4">
          Select a column from <strong>{nodeName}</strong> to use as the document column:
        </p>
        
        <div className="mb-4">
          <label htmlFor="document-column" className="block text-sm font-medium text-gray-700 mb-2">
            Document Column
          </label>
          <select
            id="document-column"
            value={selectedColumn}
            onChange={(e) => setSelectedColumn(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select a column...</option>
            {columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </div>
        
        <div className="flex justify-end space-x-2">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedColumn || submitting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Convert
          </button>
        </div>
      </div>
    </div>
  );
};

export default DocumentColumnModal;
