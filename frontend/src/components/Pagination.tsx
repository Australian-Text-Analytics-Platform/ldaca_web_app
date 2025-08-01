import React from 'react';

interface PaginationProps {
  currentPage: number;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  onPrevious,
  onNext,
  canGoPrev,
  canGoNext
}) => {
  return (
    <div className="flex justify-center items-center space-x-4 py-4">
      <button
        onClick={onPrevious}
        disabled={!canGoPrev}
        className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
          !canGoPrev 
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transform hover:-translate-y-0.5'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span>Previous</span>
      </button>
      
      <div className="bg-gray-100 px-4 py-2 rounded-lg">
        <span className="text-gray-700 font-medium">Page {currentPage + 1}</span>
      </div>
      
      <button
        onClick={onNext}
        disabled={!canGoNext}
        className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
          !canGoNext 
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transform hover:-translate-y-0.5'
        }`}
      >
        <span>Next</span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
};

export default Pagination;
