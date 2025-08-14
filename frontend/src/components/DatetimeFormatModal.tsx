import React, { useState } from 'react';

interface DatetimeFormatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (format?: string) => void;
  columnName: string;
  sampleValues?: string[]; // preview values used for auto fill inference
}

const DatetimeFormatModal: React.FC<DatetimeFormatModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  columnName,
  sampleValues = []
}) => {
  const [customFormat, setCustomFormat] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [autoFillTried, setAutoFillTried] = useState(false);
  const [autoFillError, setAutoFillError] = useState<string | null>(null);

  // Simplified options: only Auto-detect + Custom (with Auto Fill)
  const commonFormats = [
    { label: 'Auto-detect format', value: null, example: 'Auto-detect' },
  ];

  const handleAutoFill = async () => {
    setAutoFillTried(true);
    setAutoFillError(null);
    try {
      const { inferDatetimeFormat } = await import('../utils/datetimeFormatInfer');
      const inferred = inferDatetimeFormat(sampleValues || []);
      if (inferred) {
        setSelectedFormat('custom');
        setCustomFormat(inferred);
      } else {
        setAutoFillError('Could not infer format');
      }
    } catch (e) {
      setAutoFillError('Inference error');
    }
  };

  const handleConfirm = () => {
    if (selectedFormat === 'custom') {
      onConfirm(customFormat || undefined);
    } else {
      onConfirm(selectedFormat || undefined);
    }
    resetForm();
  };

  const handleCancel = () => {
    onClose();
    resetForm();
  };

  const resetForm = () => {
    setCustomFormat('');
    setSelectedFormat(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Convert "{columnName}" to Datetime
        </h3>
        
        <p className="text-sm text-gray-600 mb-4">
          Choose auto-detect or provide a custom strftime format. Use Auto Fill to guess from sample values.
        </p>

        <div className="space-y-3 mb-6">
          {commonFormats.map((format, index) => (
            <label key={index} className="flex items-center space-x-3 cursor-pointer">
              <input
                type="radio"
                name="datetime-format"
                value={format.value || 'auto'}
                checked={selectedFormat === format.value}
                onChange={() => setSelectedFormat(format.value)}
                className="text-blue-600"
              />
              <div className="flex-1">
                <div className="font-medium text-sm text-gray-900">{format.label}</div>
                <div className="text-xs text-gray-500">Example: {format.example}</div>
              </div>
            </label>
          ))}

          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="radio"
              name="datetime-format"
              value="custom"
              checked={selectedFormat === 'custom'}
              onChange={() => setSelectedFormat('custom')}
              className="mt-1 text-blue-600"
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm text-gray-900">Custom format</div>
                <button
                  type="button"
                  onClick={handleAutoFill}
                  className="ml-2 px-2 py-0.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 rounded border border-gray-300"
                  title="Infer from sample values"
                >Auto Fill</button>
              </div>
              <input
                type="text"
                placeholder="e.g., %Y-%m-%d %H:%M:%S"
                value={customFormat}
                onChange={(e) => setCustomFormat(e.target.value)}
                disabled={selectedFormat !== 'custom'}
                className="mt-1 w-full px-3 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
              <div className="text-xs text-gray-500 mt-1">
                Use Python strftime codes.
                {autoFillTried && autoFillError && <span className="ml-1 text-red-600">{autoFillError}</span>}
                {autoFillTried && !autoFillError && customFormat && <span className="ml-1 text-green-600">Inferred.</span>}
              </div>
            </div>
          </label>
        </div>

        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selectedFormat === 'custom' && !customFormat}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Convert
          </button>
        </div>
      </div>
    </div>
  );
};

export default DatetimeFormatModal;
