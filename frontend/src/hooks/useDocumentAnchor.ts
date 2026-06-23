import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ANCHOR_HIGHLIGHT_DURATION_MS } from '@/config/layout';

interface UseDocumentAnchorOptions {
  activeAnchor: string | null;
  loading: boolean;
  error: string | null;
}

/** Scrolls to and highlights a document anchor when it becomes active. */
export const useDocumentAnchor = ({ activeAnchor, loading, error }: UseDocumentAnchorOptions) => {
  const missingAnchorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeAnchor || loading || error) return;
    const anchorElement = document.getElementById(activeAnchor);
    if (!anchorElement) {
      if (missingAnchorRef.current !== activeAnchor) {
        missingAnchorRef.current = activeAnchor;
        toast('Help section not found — showing top of document.');
      }
      return;
    }
    missingAnchorRef.current = null;
    anchorElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const highlightTarget =
      anchorElement.closest('p, li, section, h2, h3, h4, h5') ?? anchorElement;
    highlightTarget.classList.add('tutorial-highlight');
    const timeoutId = window.setTimeout(() => {
      highlightTarget.classList.remove('tutorial-highlight');
    }, ANCHOR_HIGHLIGHT_DURATION_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeAnchor, error, loading]);
};
