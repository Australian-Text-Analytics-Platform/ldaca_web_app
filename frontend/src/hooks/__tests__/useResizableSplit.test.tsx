import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useResizableSplit } from '../useResizableSplit';

describe('useResizableSplit pointer dragging', () => {
  it('tracks movement on the window and cleans up after pointer release', () => {
    const { result } = renderHook(() =>
      useResizableSplit({
        mode: 'pixel',
        defaultValue: 100,
        min: 50,
        max: 300,
      }),
    );
    const container = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 400,
      bottom: 400,
      left: 0,
      width: 400,
      height: 400,
      toJSON: () => ({}),
    });
    result.current.containerRef.current = container;

    const handle = document.createElement('div');
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    act(() => {
      result.current.splitterProps.onPointerDown({
        preventDefault: vi.fn(),
        pointerId: 7,
        currentTarget: handle,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientY: 180 }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }));
    });

    expect(result.current.value).toBe(180);
    expect(result.current.isDragging).toBe(false);
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientY: 250 }));
    });
    expect(result.current.value).toBe(180);
  });

  it('ends a drag when the pointer is cancelled', () => {
    const { result } = renderHook(() => useResizableSplit({ defaultValue: 0.4 }));
    const handle = document.createElement('div');
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    act(() => {
      result.current.splitterProps.onPointerDown({
        preventDefault: vi.fn(),
        pointerId: 11,
        currentTarget: handle,
      } as unknown as React.PointerEvent<HTMLDivElement>);
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 11 }));
    });

    expect(result.current.isDragging).toBe(false);
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(11);
  });
});

describe('useResizableSplit persistence', () => {
  it.each([
    { stored: '0.08', expected: 0.2 },
    { stored: '0.92', expected: 0.8 },
  ])(
    'clamps a restored percent value of $stored to its configured bounds',
    ({ stored, expected }) => {
      window.localStorage.setItem('test.split', stored);

      const { result, unmount } = renderHook(() =>
        useResizableSplit({
          defaultValue: 0.5,
          min: 0.2,
          max: 0.8,
          persistKey: 'test.split',
        }),
      );

      expect(result.current.value).toBe(expected);
      expect(result.current.splitterProps['aria-valuenow']).toBe(expected * 100);
      expect(window.localStorage.getItem('test.split')).toBe(String(expected));

      unmount();
      window.localStorage.removeItem('test.split');
    },
  );
});
