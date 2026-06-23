import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useStackedSplits } from '../useStackedSplits';

describe('useStackedSplits', () => {
  it('uses section-specific minimum heights while resizing stacked sections', () => {
    const { result } = renderHook(() =>
      useStackedSplits(['nodes', 'tasks'] as const, {
        minSectionPx: 120,
        sectionMinPx: { tasks: 56 },
        initialRatios: { nodes: 0.8, tasks: 0.2 },
      }),
    );

    act(() => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'getBoundingClientRect', {
        value: () => ({ height: 400 }),
      });
      result.current.containerRef.current = container;
    });

    act(() => {
      result.current.handleResizeStart('nodes', 'tasks', {
        button: 0,
        clientY: 0,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>);
      window.dispatchEvent(new MouseEvent('mousemove', { clientY: 200 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(result.current.getSectionFlexStyle('nodes')).toMatchObject({ flexGrow: 0.86 });
    expect(result.current.getSectionFlexStyle('tasks')).toMatchObject({ flexGrow: 0.14 });
  });
});
