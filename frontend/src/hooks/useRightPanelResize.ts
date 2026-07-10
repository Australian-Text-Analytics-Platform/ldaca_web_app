import { useState, useRef } from 'react';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import {
  ASIDE_PANEL_DEFAULT_RATIO,
  ASIDE_PANEL_MIN_RATIO,
  ASIDE_PANEL_MAX_RATIO,
  ASIDE_PANEL_MAX_PIXELS,
} from '@/config/layout';

/**
 * Percent-based right panel resize + collapse toggle.
 *
 * Collapse is a real visibility mode owned by the shell; it does not rewrite
 * the persisted split ratio, so expanding restores the exact live layout
 * without a second ratio state.
 */
export const useRightPanelResize = () => {
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  const {
    containerRef: layoutRef,
    value: asidePanelRatio,
    isDragging: isResizing,
    splitterProps: rightPanelSplitterProps,
  } = useResizableSplit({
    orientation: 'vertical',
    anchor: 'end',
    mode: 'percent',
    defaultValue: ASIDE_PANEL_DEFAULT_RATIO,
    min: ASIDE_PANEL_MIN_RATIO,
    max: ASIDE_PANEL_MAX_RATIO,
    maxPixels: ASIDE_PANEL_MAX_PIXELS,
    persistKey: 'ldaca.layout.asidePanelRatio',
    onLiveUpdate: (next) => {
      if (mainRef.current) mainRef.current.style.width = `${String((1 - next) * 100)}%`;
      if (asideRef.current) asideRef.current.style.width = `${String(next * 100)}%`;
    },
  });

  /** Toggles the shell's zero-width aside without mutating its split ratio. */
  const toggleRightPanel = () => {
    setIsRightCollapsed((previous) => !previous);
  };

  return {
    layoutRef,
    asidePanelRatio,
    isResizing,
    rightPanelSplitterProps,
    isRightCollapsed,
    toggleRightPanel,
    mainRef,
    asideRef,
  };
};
