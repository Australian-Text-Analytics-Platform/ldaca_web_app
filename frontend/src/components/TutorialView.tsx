import React, { useEffect, useState, useCallback } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import logo from '../logo.png';

const markdownComponents: Components = {
  img: ({ node: _node, className, alt, ...props }) => {
    const mergedClassName = ['max-w-full h-auto', className].filter(Boolean).join(' ');
    const resolvedAlt = typeof alt === 'string' ? alt : '';
    return <img {...props} className={mergedClassName.trim()} alt={resolvedAlt} />;
  },
  a: ({ node: _node, children, target, rel, ...props }) => (
    <a {...props} target={target ?? '_blank'} rel={rel ?? 'noopener noreferrer'}>
      {children}
    </a>
  ),
};

/**
 * TutorialView: renders the markdown from public/tutorial.md.
 * This page is shown when opening the app with location.hash === '#/tutorial'.
 */
const TutorialView: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1);

  const resolveTutorialUrl = useCallback((): string => {
    if (typeof window === 'undefined') {
      return 'tutorial.md';
    }

    const baseHref = document.querySelector('base')?.href;
    if (baseHref) {
      try {
        return new URL('tutorial.md', baseHref).toString();
      } catch {
        // ignore invalid base href and fall back to location-based resolution
      }
    }

    try {
      const base = window.location.href.split('#')[0];
      return new URL('tutorial.md', base).toString();
    } catch {
      return 'tutorial.md';
    }
  }, []);

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
        const url = resolveTutorialUrl();
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        if (!cancelled) setContent(text);
      } catch (error: unknown) {
        if (!cancelled) {
          const message = error instanceof Error && error.message ? error.message : 'Failed to load tutorial';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [resolveTutorialUrl]);

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
      <header className="bg-card border-b border-border px-6 py-4">
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
                className="px-2 py-1 rounded border border-input text-foreground hover:bg-muted/60"
                aria-label="Zoom out"
                title="Zoom out (Ctrl/Cmd -)"
              >
                −
              </button>
              <button
                type="button"
                onClick={zoomReset}
                className="px-2 py-1 rounded border border-input text-foreground hover:bg-muted/60 min-w-[64px]"
                aria-label="Reset zoom"
                title="Reset zoom (Ctrl/Cmd 0)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={zoomIn}
                className="px-2 py-1 rounded border border-input text-foreground hover:bg-muted/60"
                aria-label="Zoom in"
                title="Zoom in (Ctrl/Cmd +)"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto bg-card shadow-sm rounded-lg border border-border mt-6 mb-10 p-6">
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
          <ReactMarkdown rehypePlugins={[rehypeRaw]} components={markdownComponents}>
            {content}
          </ReactMarkdown>
        )}
        </div>
      </main>
    </div>
  );
};

export default TutorialView;
