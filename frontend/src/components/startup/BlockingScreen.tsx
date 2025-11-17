import React from 'react';
import logo from '../../logo.png';

type BlockingScreenProps = {
  title: string;
  description: string;
  status?: string;
  hint?: string;
  error?: string | null;
  actions?: React.ReactNode;
  showLogo?: boolean;
};

/**
 * Shared full-screen blocking screen used while the desktop app waits for the
 * backend to become healthy or while the auth handshake is still running.
 */
const BlockingScreen: React.FC<BlockingScreenProps> = ({
  title,
  description,
  status = 'Loading…',
  hint,
  error,
  actions,
  showLogo = true,
}) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-blue-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl text-center space-y-6 bg-white/80 backdrop-blur rounded-2xl shadow-2xl border border-white/60 px-10 py-12">
        {showLogo && (
          <div className="flex justify-center">
            <img
              src={logo}
              alt="LDaCA Logo"
              className="h-16 w-auto object-contain drop-shadow"
            />
          </div>
        )}
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-gray-900">{title}</h1>
          <p className="text-base text-gray-600">{description}</p>
        </div>
        <div className="flex flex-col items-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-100 border-t-blue-600" />
          <p className="text-gray-800 font-medium">{status}</p>
          {hint && <p className="text-sm text-gray-500 max-w-sm mx-auto">{hint}</p>}
        </div>
        {error && (
          <div className="text-left rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-semibold text-red-700 mb-1">Still waiting…</p>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
        {actions && <div className="flex flex-wrap justify-center gap-3">{actions}</div>}
      </div>
    </div>
  );
};

export default BlockingScreen;
