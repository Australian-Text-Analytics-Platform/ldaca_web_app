import { useState, useRef } from 'react';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import {
  ASIDE_PANEL_DEFAULT_RATIO,
  ASIDE_PANEL_MIN_RATIO,
  ASIDE_PANEL_MAX_RATIO,
  ASIDE_PANEL_MAX_PIXELS,
  ASIDE_PANEL_COLLAPSED_RATIO,
} from '@/config/layout';

/**
 * Percent-based right panel resize + collapse toggle.
 *
 * "Collapse" no longer hides the panel — it switches the panel content to the
 * compact list + schema view (handled by the consumer) and snaps the panel to a
 * narrower default ratio. The panel stays resizable in both states; expanding
 * restores the ratio the user had before collapsing.
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
      if (mainRef.current) mainRef.current.style.width = `${String((1 - next) * 100)}%`;
      if (asideRef.current) asideRef.current.style.width = `${String(next * 100)}%`;
    },
  });

  /** Toggles between the full graph/table view and the compact list/schema view.
   * On collapse, remembers the current ratio and snaps to the narrower collapsed
   * ratio; on expand, restores the remembered ratio. */
  const toggleRightPanel = () => {
    setIsRightCollapsed((prev) => {
      if (prev) {
        setAsidePanelRatio(lastAsidePanelRatio);
        return false;
      }
      setLastAsidePanelRatio(asidePanelRatio);
      setAsidePanelRatio(ASIDE_PANEL_COLLAPSED_RATIO);
      return true;
    });
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
