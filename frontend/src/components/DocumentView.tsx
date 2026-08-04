import React, { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import logo from '../logo.png';
import 'katex/dist/katex.min.css';
import { BUNDLED_DOCUMENT_FILES, type DocumentTarget } from '@/tutorials/documentationRegistry';
import { APP_VERSION, APP_BUILD_DATE, APP_BUILD, getDocsBaseUrl } from '@/config/env';
import { useZoom } from '@/hooks/useZoom';
import { useDocumentAnchor } from '@/hooks/useDocumentAnchor';

export type DocumentType = 'tutorial' | 'information' | 'reference';

interface NavigationState {
  propTarget: DocumentTarget;
  currentTarget: DocumentTarget;
}

/** Document viewer presentation keyed by canonical help/info/reference kind. */
const DOC_CONFIG: Record<DocumentType, { title: string }> = {
  tutorial: { title: 'LDaCA Help' },
  information: { title: 'LDaCA Information' },
  reference: { title: 'LDaCA References' },
};

/** Called by: DocumentView link handlers when resolving local markdown hrefs. */
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

/** Called by: DocumentView markdown anchor rendering to identify links that should leave the modal. */
const isExternalLink = (href?: string | null): boolean => {
  if (!href) return false;
  return /^(https?:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:');
};

/** Called by: resolveDocUrl when bundled docs need desktop/web base-path resolution. */
const resolveLocalDocUrl = (requestedFile: string): string => {
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

/**
 * Resolves a requested doc file to the URL fetched by `DocumentView`.
 * Called by: DocumentView when constructing its bundled fallback source.
 */
const resolveFromRoot = (requestedPath: string, root: string): string => {
  const rootWithSlash = root.endsWith('/') ? root : `${root}/`;
  return new URL(requestedPath.replace(/^\/+/, ''), rootWithSlash).toString();
};

const resolveAssetUrl = (
  requestedPath: string | undefined,
  sourceRoot: string,
): string | undefined => {
  if (!requestedPath || !sourceRoot || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(requestedPath)) {
    return requestedPath;
  }
  try {
    return resolveFromRoot(requestedPath, sourceRoot);
  } catch {
    return requestedPath;
  }
};

/**
 * Markdown document reader used by help dialogs and standalone documentation
 * routes. It owns loading, intra-doc navigation, anchor highlighting, and zoom
 * controls so help icons can open the same viewer for tutorials, information,
 * and references.
 * Why: all help/reference entry points need one markdown viewer that works for bundled, remote, modal, and standalone docs.
 * Flow: resolve the active document target, fetch markdown with build placeholders, sync anchors and zoom state, then render markdown navigation controls.
 */
function DocumentView({
  docType,
  onClose,
  target,
}: {
  docType: DocumentType;
  onClose?: () => void;
  target: DocumentTarget;
}) {
  const config = DOC_CONFIG[docType];
  const [content, setContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [documentSourceRoot, setDocumentSourceRoot] = useState<string>('');
  const [navigationState, setNavigationState] = useState<NavigationState>(() => ({
    propTarget: target,
    currentTarget: target,
  }));
  const currentTarget =
    navigationState.propTarget !== target ? target : navigationState.currentTarget;
  const activeAnchor = currentTarget.anchor;

  const { zoom, zoomIn, zoomOut, zoomReset } = useZoom({ keyboardShortcuts: true });

  useDocumentAnchor({ activeAnchor, loading, error });

  useEffect(() => {
    let cancelled = false;
    /**
     * Called by: DocumentView's markdown-loading effect whenever the selected file changes.
     * Flow: derive the requested doc URL, fetch markdown without cache, replace build placeholders, then update content/error/loading if still mounted.
     */
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const requestedFile = currentTarget.file;
        const remoteBase = getDocsBaseUrl();
        const localRoot = resolveLocalDocUrl('');
        const sources: { url: string; root: string }[] = [];
        if (remoteBase) {
          sources.push({ url: resolveFromRoot(requestedFile, remoteBase), root: remoteBase });
        }
        if (!remoteBase || BUNDLED_DOCUMENT_FILES.has(requestedFile)) {
          sources.push({ url: resolveLocalDocUrl(requestedFile), root: localRoot });
        }

        let text: string | null = null;
        let sourceRoot = '';
        let lastError: Error = new Error('Failed to load document');
        for (const source of sources) {
          try {
            const resp = await fetch(source.url, { cache: 'no-store' });
            if (!resp.ok) {
              lastError = new Error(`HTTP ${String(resp.status)}`);
              continue;
            }
            text = await resp.text();
            sourceRoot = source.root;
            break;
          } catch (sourceError: unknown) {
            lastError =
              sourceError instanceof Error ? sourceError : new Error('Failed to load document');
          }
        }
        if (text === null) throw lastError;
        // Substitute build-time placeholders so docs like
        // `references/general.md` can show the current app version /
        // build date without manual edits per release. Inserted via
        // Vite's `define` (see vite.config.ts).
        const rendered = text
          .replace(/\{\{\s*VERSION\s*\}\}/g, APP_VERSION)
          .replace(/\{\{\s*BUILD_DATE\s*\}\}/g, APP_BUILD_DATE)
          .replace(/\{\{\s*BUILD\s*\}\}/g, APP_BUILD);
        if (!cancelled) {
          setContent(rendered);
          setDocumentSourceRoot(sourceRoot);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message =
            err instanceof Error && err.message ? err.message : 'Failed to load document';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentTarget.file]);

  /**
   * Markdown render overrides used by `ReactMarkdown` for safe image sizing and in-modal doc links.
   * Why: bundled docs should keep internal links inside the viewer while external links retain normal browser behavior.
   * Flow: constrain image sizing and alt text, rewrite internal markdown anchors to viewer state, then leave external links opening safely.
   */
  const markdownComponents: Components = {
    /** Called by: ReactMarkdown when rendering markdown image nodes inside DocumentView. */
    img: ({ node: _node, className, alt, src, ...props }) => {
      const mergedClassName = ['max-w-full h-auto', className].filter(Boolean).join(' ');
      const resolvedAlt = typeof alt === 'string' ? alt : '';
      return (
        <img
          {...props}
          src={resolveAssetUrl(src, documentSourceRoot)}
          className={mergedClassName.trim()}
          alt={resolvedAlt}
        />
      );
    },
    /**
     * Rewrites markdown anchors so document consumers stay inside the modal navigation flow.
     * Flow: resolve relative markdown hrefs against the current file, route internal `.md` links through navigation state, and pass external links through.
     */
    a: ({ node: _node, children, href, target: linkTarget, rel, ...props }) => {
      const baseFile = currentTarget.file;
      /**
       * Called by: the markdown anchor onClick prop to route internal links through DocumentView state.
       * Flow: parse the clicked href path/hash, resolve the next markdown file, prevent default navigation, then store the next file/anchor target.
       */
      const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (!href || isExternalLink(href)) return;
        const [rawPath, rawHash] = href.split('#');
        const nextAnchor = rawHash ? rawHash.trim() : '';
        let nextFile = baseFile;
        if (rawPath?.trim()) {
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
        setNavigationState({
          propTarget: target,
          currentTarget: {
            kind: currentTarget.kind,
            key: `link:${nextFile}#${nextAnchor}`,
            file: nextFile,
            anchor: nextAnchor,
          },
        });
      };

      if (isExternalLink(href)) {
        return (
          <a
            {...props}
            href={href}
            target={linkTarget ?? '_blank'}
            rel={rel ?? 'noopener noreferrer'}
          >
            {children}
          </a>
        );
      }

      const renderedHref =
        href?.endsWith('.md') || href?.includes('.md#')
          ? href
          : resolveAssetUrl(href, documentSourceRoot);
      return (
        <a {...props} href={renderedHref} onClick={handleClick}>
          {children}
        </a>
      );
    },
  };

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
            transform: `scale(${String(zoom)})`,
            transformOrigin: 'top center',
          }}
        >
          {loading && <div className="text-center text-gray-600">Loading…</div>}
          {error && <div className="text-red-600">{error}</div>}
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
}

export default DocumentView;
