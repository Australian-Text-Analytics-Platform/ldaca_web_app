import React, { useEffect, useState, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import logo from '../logo.png';
import { toast } from 'sonner';
import 'katex/dist/katex.min.css';

export type DocumentTarget = {
  file: string;
  anchor: string;
  label?: string;
};

export type DocumentType = 'tutorial' | 'warning' | 'information' | 'reference';

const DOC_CONFIG: Record<DocumentType, { title: string; defaultFile: string }> = {
  tutorial: { title: 'LDaCA Tutorial', defaultFile: 'tutorials/index.md' },
  warning: { title: 'LDaCA Warnings', defaultFile: 'warnings/index.md' },
  information: { title: 'LDaCA Information', defaultFile: 'information/index.md' },
  reference: { title: 'LDaCA References', defaultFile: 'references/index.md' },
};

const normalizePath = (input: string): string => {
  const segments = input.split('/');
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join('/');
};

const isExternalLink = (href?: string | null): boolean => {
  if (!href) return false;
  return /^(https?:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:');
};

const resolveDocUrl = (requestedFile: string): string => {
  if (typeof window === 'undefined') {
    return requestedFile;
  }

  const baseHref = document.querySelector('base')?.href;
  if (baseHref) {
    try {
      return new URL(requestedFile, baseHref).toString();
    } catch {
      // fall back to location-based resolution
    }
  }

  try {
    const base = window.location.href.split('#')[0];
    return new URL(requestedFile, base).toString();
  } catch {
    return requestedFile;
  }
};

const DocumentView: React.FC<{
  docType: DocumentType;
  onClose?: () => void;
  target?: DocumentTarget | null;
}> = ({ docType, onClose, target }) => {
  const config = DOC_CONFIG[docType];
  const [content, setContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1);
  const [currentTarget, setCurrentTarget] = useState<DocumentTarget | null>(target ?? null);
  const [activeAnchor, setActiveAnchor] = useState<string | null>(target?.anchor ?? null);
  const missingAnchorRef = useRef<string | null>(null);

  const clamp = (v: number) => Math.min(2, Math.max(0.5, v));
  const zoomIn = () => setZoom((z) => clamp(parseFloat((z + 0.1).toFixed(2))));
  const zoomOut = () => setZoom((z) => clamp(parseFloat((z - 0.1).toFixed(2))));
  const zoomReset = () => setZoom(1);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const requestedFile = currentTarget?.file ?? config.defaultFile;
        const url = resolveDocUrl(requestedFile);
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        if (!cancelled) setContent(text);
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error && err.message ? err.message : 'Failed to load document';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [currentTarget?.file, config.defaultFile]);

  useEffect(() => {
    setActiveAnchor(currentTarget?.anchor ?? null);
  }, [currentTarget?.anchor]);

  useEffect(() => {
    if (!target) return;
    setCurrentTarget(target);
  }, [target]);

  useEffect(() => {
    if (!activeAnchor || loading || error) return;
    const anchorElement = document.getElementById(activeAnchor);
    if (!anchorElement) {
      if (missingAnchorRef.current !== activeAnchor) {
        missingAnchorRef.current = activeAnchor;
        toast('Help anchor not found.');
        if (onClose) {
          onClose();
        }
      }
      return;
    }
    missingAnchorRef.current = null;
    anchorElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const highlightTarget = anchorElement.closest('p, li, section, h2, h3, h4, h5') ?? anchorElement;
    highlightTarget.classList.add('tutorial-highlight');
    const timeoutId = window.setTimeout(() => {
      highlightTarget.classList.remove('tutorial-highlight');
    }, 3500);
    return () => window.clearTimeout(timeoutId);
  }, [activeAnchor, error, loading, onClose]);

  const markdownComponents: Components = {
    img: ({ node: _node, className, alt, ...props }) => {
      const mergedClassName = ['max-w-full h-auto', className].filter(Boolean).join(' ');
      const resolvedAlt = typeof alt === 'string' ? alt : '';
      return <img {...props} className={mergedClassName.trim()} alt={resolvedAlt} />;
    },
    a: ({ node: _node, children, href, target: linkTarget, rel, ...props }) => {
      const baseFile = currentTarget?.file ?? config.defaultFile;
      const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (!href || isExternalLink(href)) return;
        const [rawPath, rawHash] = href.split('#');
        const nextAnchor = rawHash ? rawHash.trim() : '';
        let nextFile = baseFile;
        if (rawPath && rawPath.trim()) {
          const trimmed = rawPath.trim();
          if (trimmed.startsWith('/')) {
            nextFile = normalizePath(trimmed.replace(/^\/+/, ''));
          } else {
            const baseDir = baseFile.includes('/')
              ? baseFile.slice(0, baseFile.lastIndexOf('/') + 1)
              : '';
            nextFile = normalizePath(`${baseDir}${trimmed}`);
          }
        }
        if (!nextFile.endsWith('.md')) return;
        event.preventDefault();
        setCurrentTarget({ file: nextFile, anchor: nextAnchor });
      };

      if (isExternalLink(href)) {
        return (
          <a {...props} href={href} target={linkTarget ?? '_blank'} rel={rel ?? 'noopener noreferrer'}>
            {children}
          </a>
        );
      }

      return (
        <a {...props} href={href} onClick={handleClick}>
          {children}
        </a>
      );
    },
  };

  useEffect(() => {
    const clampZoom = (v: number) => Math.min(2, Math.max(0.5, v));
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom((z) => clampZoom(parseFloat((z + 0.1).toFixed(2)))); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom((z) => clampZoom(parseFloat((z - 0.1).toFixed(2)))); }
      else if (e.key === '0') { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50">
      <header className="bg-card border-b border-border px-6 py-4 pr-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="LDaCA Logo" className="h-8 w-auto object-contain" />
            <h1 className="text-xl font-bold text-gray-800">{config.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <button
              type="button"
              className="text-sm text-blue-600 hover:text-blue-700 whitespace-nowrap"
              onClick={() => {
                if (onClose) {
                  onClose();
                } else {
                  window.location.assign('/');
                }
              }}
            >
              {onClose ? 'Close' : 'Back to app'}
            </button>
            <div className="flex items-center gap-2">
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
                className="px-2 py-1 rounded border border-input text-foreground hover:bg-muted/60 min-w-16"
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
          <div className="text-center text-gray-600">Loading…</div>
        )}
        {error && (
          <div className="text-red-600">{error}</div>
        )}
        {!loading && !error && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeRaw, rehypeKatex]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        )}
        </div>
      </main>
    </div>
  );
};

export default DocumentView;
