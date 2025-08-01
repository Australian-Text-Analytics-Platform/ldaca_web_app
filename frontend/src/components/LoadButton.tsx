import React from 'react';

interface LoadButtonProps {
  onLoad: () => void;
  disabled: boolean;
  loading: boolean;
}

const LoadButton: React.FC<LoadButtonProps> = ({ onLoad, disabled, loading }) => {
  return (
    <button
      onClick={onLoad}
      disabled={disabled}
      className={`w-full py-3 px-4 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center space-x-2 ${
        disabled 
          ? 'bg-gray-400 text-gray-100 cursor-not-allowed' 
          : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
      }`}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      <span>{loading ? 'Loading...' : 'Load File'}</span>
    </button>
  );
};

export default LoadButton;
