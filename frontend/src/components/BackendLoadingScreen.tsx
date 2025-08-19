import React from 'react';
import logo from '../logo.png';

interface BackendLoadingScreenProps {
  status?: 'healthy' | 'starting' | 'not_found' | 'error';
  error?: string | null;
  onRetry?: () => void;
}

const BackendLoadingScreen: React.FC<BackendLoadingScreenProps> = ({ status = 'error', error, onRetry }) => {
  const getTitle = () => {
    switch (status) {
      case 'not_found':
        return 'Backend Not Found';
      case 'starting':
        return 'Backend Server Found, Starting...';
      case 'error':
      default:
        return 'Backend Connection Failed';
    }
  };

  const getDescription = () => {
    switch (status) {
      case 'not_found':
        return 'Unable to find the backend server. Please make sure the backend service is running on port 8001.';
      case 'starting':
        return 'The backend server is starting up. This usually takes a few moments...';
      case 'error':
      default:
        return 'Unable to connect to the backend server. This may happen when:';
    }
  };

  const getReasons = () => {
    if (status === 'not_found') {
      return [
        '• The backend service is not running',
        '• The backend is configured for a different port',
        '• There may be a firewall blocking the connection'
      ];
    } else if (status === 'starting') {
      return [
        '• Loading and initializing application modules',
        '• Setting up database connections',
        '• Preparing the analysis environment'
      ];
    } else {
      return [
        '• The backend is still starting up',
        '• There\'s a network connectivity issue',
        '• The backend service is temporarily unavailable'
      ];
    }
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
      <div className="text-center max-w-md w-full mx-4">
        <div className="bg-white p-8 rounded-xl shadow-lg">
          {/* Logo */}
          <div className="mb-6">
            <img 
              src={logo} 
              alt="LDaCA Logo" 
              className="h-16 w-auto mx-auto mb-4"
              onError={(e) => {
                // Fallback if logo fails to load
                e.currentTarget.style.display = 'none';
              }}
            />
            <h1 className="text-2xl font-bold text-gray-800 mb-2">
              LDaCA Corpus Analysis
            </h1>
          </div>

          {error || status !== 'healthy' ? (
            <>
              <div className="mb-4">
                <div className={`animate-spin w-12 h-12 border-4 rounded-full mx-auto mb-4 ${
                  status === 'not_found' 
                    ? 'border-gray-200 border-t-gray-600' 
                    : status === 'starting'
                    ? 'border-blue-200 border-t-blue-600'
                    : 'border-red-200 border-t-red-600'
                }`}></div>
                <p className={`font-semibold mb-2 ${
                  status === 'not_found' 
                    ? 'text-gray-700' 
                    : status === 'starting'
                    ? 'text-blue-600'
                    : 'text-red-600'
                }`}>{getTitle()}</p>
                <p className="text-gray-600 text-sm mb-4">
                  {getDescription()}
                </p>
                {status !== 'starting' && (
                  <ul className="text-gray-600 text-sm text-left space-y-1 mb-4">
                    {getReasons().map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                )}
                {error && (
                  <p className="text-gray-500 text-xs mb-4">
                    Error: {error}
                  </p>
                )}
              </div>
              {onRetry && status !== 'starting' && (
                <button
                  onClick={onRetry}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors duration-200"
                >
                  Retry Connection
                </button>
              )}
            </>
          ) : (
            <>
              <div className="mb-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-700 font-semibold mb-2">Starting Backend Services</p>
                <p className="text-gray-600 text-sm">
                  Please wait while we establish connection to the backend server...
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
                <p className="text-gray-500 text-xs">
                  This usually takes a few seconds...
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BackendLoadingScreen;
