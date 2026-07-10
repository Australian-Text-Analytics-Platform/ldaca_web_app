import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ASIDE_PANEL_DEFAULT_RATIO } from '@/config/layout';
import { useRightPanelResize } from '../useRightPanelResize';

describe('useRightPanelResize', () => {
  it('collapses visibility without replacing the user split ratio', () => {
    const { result } = renderHook(() => useRightPanelResize());

    expect(result.current.asidePanelRatio).toBe(ASIDE_PANEL_DEFAULT_RATIO);
    act(() => {
      result.current.toggleRightPanel();
    });

    expect(result.current.isRightCollapsed).toBe(true);
    expect(result.current.asidePanelRatio).toBe(ASIDE_PANEL_DEFAULT_RATIO);

    act(() => {
      result.current.toggleRightPanel();
    });
    expect(result.current.isRightCollapsed).toBe(false);
    expect(result.current.asidePanelRatio).toBe(ASIDE_PANEL_DEFAULT_RATIO);
  });
});
