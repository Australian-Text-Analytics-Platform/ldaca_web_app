import { useState, useRef, useCallback } from 'react';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import { ASIDE_PANEL_DEFAULT_RATIO, ASIDE_PANEL_MIN_RATIO, ASIDE_PANEL_MAX_RATIO, ASIDE_PANEL_MAX_PIXELS } from '@/config/layout';

/**
 * Percent-based right panel resize + collapse toggle.
 * Collapsing remembers the last ratio so re-expanding restores it.
 */
export const useRightPanelResize = () => {
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const [lastAsidePanelRatio, setLastAsidePanelRatio] = useState<number>(ASIDE_PANEL_DEFAULT_RATIO);
  const mainRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  const {
    containerRef: layoutRef,
    value: asidePanelRatio,
    setValue: setAsidePanelRatio,
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
      if (isRightCollapsed) return;
      if (mainRef.current) mainRef.current.style.width = `${(1 - next) * 100}%`;
      if (asideRef.current) asideRef.current.style.width = `${next * 100}%`;
    },
  });

  const toggleRightPanel = useCallback(() => {
    setIsRightCollapsed((prev) => {
      if (prev) {
        setAsidePanelRatio(lastAsidePanelRatio);
        return false;
      }
      setLastAsidePanelRatio(asidePanelRatio);
      return true;
    });
  }, [asidePanelRatio, lastAsidePanelRatio, setAsidePanelRatio]);

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
