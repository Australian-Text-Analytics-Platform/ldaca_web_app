import { useCallback, useRef, useState } from 'react';

type UseResizableSplitOptions = {
  defaultRatio?: number;
  min?: number;
  max?: number;
};

export type ResizableSplitHandle = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  topRatio: number;
  setTopRatio: React.Dispatch<React.SetStateAction<number>>;
  splitterProps: {
    role: 'separator';
    'aria-orientation': 'horizontal';
    'aria-valuenow': number;
    'aria-valuemin': number;
    'aria-valuemax': number;
    tabIndex: 0;
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    onDoubleClick: () => void;
  };
};

export function useResizableSplit({
  defaultRatio = 0.4,
  min = 0.15,
  max = 0.85,
}: UseResizableSplitOptions = {}): ResizableSplitHandle {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [topRatio, setTopRatio] = useState(defaultRatio);

  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore pointer capture errors
    }
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;
      const offset = event.clientY - rect.top;
      setTopRatio(clamp(offset / rect.height));
    },
    [clamp],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore pointer capture errors
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setTopRatio((prev) => clamp(prev - 0.05));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setTopRatio((prev) => clamp(prev + 0.05));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setTopRatio(min);
      } else if (event.key === 'End') {
        event.preventDefault();
        setTopRatio(max);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setTopRatio(0.5);
      }
    },
    [clamp, min, max],
  );

  const onDoubleClick = useCallback(() => setTopRatio(0.5), []);

  const splitterProps: ResizableSplitHandle['splitterProps'] = {
    role: 'separator',
    'aria-orientation': 'horizontal',
    'aria-valuenow': Math.round(topRatio * 100),
    'aria-valuemin': Math.round(min * 100),
    'aria-valuemax': Math.round(max * 100),
    tabIndex: 0,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onKeyDown,
    onDoubleClick,
  };

  return { containerRef, topRatio, setTopRatio, splitterProps };
}
