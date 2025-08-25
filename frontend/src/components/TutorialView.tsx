import React, { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import logo from '../logo.png';

/**
 * TutorialView: renders the markdown from public/tutorial.md.
 * This page is shown when opening the app with location.hash === '#/tutorial'.
 */
const TutorialView: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1);

  const clamp = (v: number) => Math.min(2, Math.max(0.5, v));
  const zoomIn = useCallback(() => setZoom((z) => clamp(parseFloat((z + 0.1).toFixed(2)))), []);
  const zoomOut = useCallback(() => setZoom((z) => clamp(parseFloat((z - 0.1).toFixed(2)))), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
        const url = `${base}/tutorial.md`; // resolves to './tutorial.md' in CRA with homepage='.'
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        if (!cancelled) setContent(text);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load tutorial');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Keyboard shortcuts: Cmd/Ctrl +/- and 0 to reset
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
      else if (e.key === '0') { e.preventDefault(); zoomReset(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomIn, zoomOut, zoomReset]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={logo} alt="LDaCA Logo" className="h-8 w-auto object-contain" />
            <h1 className="text-xl font-bold text-gray-800">LDaCA Tutorial</h1>
          </div>
          <div className="flex items-center space-x-4">
            <button
              type="button"
              className="text-sm text-blue-600 hover:text-blue-700"
              onClick={() => { window.location.hash = ''; window.location.reload(); }}
            >
              Back to app
            </button>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={zoomOut}
                className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                aria-label="Zoom out"
                title="Zoom out (Ctrl/Cmd -)"
              >
                −
              </button>
              <button
                type="button"
                onClick={zoomReset}
                className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 min-w-[64px]"
                aria-label="Reset zoom"
                title="Reset zoom (Ctrl/Cmd 0)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={zoomIn}
                className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                aria-label="Zoom in"
                title="Zoom in (Ctrl/Cmd +)"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto bg-white shadow-sm rounded-lg border border-gray-200 mt-6 mb-10 p-6">
        <div
          className="prose prose-slate prose-img:mx-auto mx-auto"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
          }}
        >
        {loading && (
          <div className="text-center text-gray-600">Loading tutorial…</div>
        )}
        {error && (
          <div className="text-red-600">{error}</div>
        )}
        {!loading && !error && (
          <ReactMarkdown
            // Allow literal HTML in markdown (e.g., <p align="center">)
            rehypePlugins={[rehypeRaw]}
            components={{
              // Ensure images scale nicely within prose container
              img: (props) => (
                // eslint-disable-next-line jsx-a11y/alt-text
                <img {...props} className={`max-w-full h-auto ${props.className || ''}`} />
              ),
              a: ({ children, ...props }) => (
                <a {...props as any} target={(props as any).target || '_blank'} rel="noopener noreferrer">{children}</a>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        )}
        </div>
      </main>
    </div>
  );
};

export default TutorialView;
