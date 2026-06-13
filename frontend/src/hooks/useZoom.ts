import { useState, useEffect, useCallback } from 'react';
import { DOC_ZOOM_MIN, DOC_ZOOM_MAX, DOC_ZOOM_STEP } from '@/config/layout';

interface UseZoomOptions {
  /** Whether to listen for Ctrl/Cmd +/-/0 keyboard shortcuts. */
  keyboardShortcuts?: boolean;
  /** Initial zoom level (default 1 = 100%). */
  initial?: number;
}

/** Generic zoom controls with optional keyboard shortcut listeners. */
export const useZoom = ({ keyboardShortcuts = false, initial = 1 }: UseZoomOptions = {}) => {
  const [zoom, setZoom] = useState(initial);

  const clamp = useCallback((v: number) => Math.min(DOC_ZOOM_MAX, Math.max(DOC_ZOOM_MIN, v)), []);

  const zoomIn = useCallback(
    () => { setZoom((z) => clamp(parseFloat((z + DOC_ZOOM_STEP).toFixed(2)))); },
    [clamp],
  );
  const zoomOut = useCallback(
    () => { setZoom((z) => clamp(parseFloat((z - DOC_ZOOM_STEP).toFixed(2)))); },
    [clamp],
  );
  const zoomReset = useCallback(() => { setZoom(1); }, []);

  useEffect(() => {
    if (!keyboardShortcuts) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom((z) => clamp(parseFloat((z + DOC_ZOOM_STEP).toFixed(2))));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom((z) => clamp(parseFloat((z - DOC_ZOOM_STEP).toFixed(2))));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [keyboardShortcuts, clamp]);

  return { zoom, zoomIn, zoomOut, zoomReset, clamp };
};
