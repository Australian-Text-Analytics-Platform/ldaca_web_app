import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface DataBlockNameProps {
  name: string;
  backgroundColor: string;
  maxLines: 1 | 2 | 3;
  fadeEdge?: 'head' | 'tail';
  className?: string;
  fadeClassName?: string;
  title?: string;
}

/**
 * Displays a Data Block name without inserting an ellipsis. Tail fade keeps
 * the beginning visible; head fade keeps the suffix visible. Wrapped head-fade
 * names retain their final lines, while a single-line name clips from the left.
 * The full name remains available through the surrounding tooltip or title.
 */
export function DataBlockName({
  name,
  backgroundColor,
  maxLines,
  fadeEdge = 'tail',
  className,
  fadeClassName,
  title,
}: DataBlockNameProps) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      setIsOverflowing(
        content.scrollHeight > viewport.clientHeight + 1 ||
          content.scrollWidth > viewport.clientWidth + 1,
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [fadeEdge, name, maxLines]);

  const fadesHead = fadeEdge === 'head';
  const isSingleLine = maxLines === 1;
  const fadeGradient = fadesHead
    ? isSingleLine
      ? `linear-gradient(to left, transparent, ${backgroundColor} 72%)`
      : `linear-gradient(to bottom, ${backgroundColor} 24%, transparent)`
    : `linear-gradient(to right, transparent, ${backgroundColor} 72%)`;

  return (
    <span
      ref={viewportRef}
      data-testid="data-block-name"
      dir={fadesHead && isSingleLine && isOverflowing ? 'rtl' : 'ltr'}
      className={cn(
        'relative min-w-0 overflow-hidden text-left',
        isSingleLine ? 'block whitespace-nowrap' : 'whitespace-normal',
        fadesHead && !isSingleLine ? 'flex flex-col justify-end' : 'block',
        className,
      )}
      style={{
        maxHeight: `${String(maxLines)}lh`,
        overflowWrap: 'anywhere',
      }}
      title={title}
    >
      <span
        ref={contentRef}
        dir="ltr"
        className={cn(
          'block',
          isSingleLine ? 'min-w-full w-max whitespace-nowrap' : 'shrink-0 whitespace-normal',
          fadesHead && isSingleLine && isOverflowing && 'text-right',
        )}
      >
        {name}
      </span>
      <span
        data-testid={`data-block-name-${fadeEdge}-fade`}
        aria-hidden="true"
        style={{
          height: '1lh',
          backgroundImage: fadeGradient,
        }}
        className={cn(
          'pointer-events-none absolute',
          fadesHead
            ? isSingleLine
              ? 'bottom-0 left-0 w-10'
              : 'inset-x-0 top-0'
            : 'right-0 bottom-0 w-10',
          isOverflowing ? 'opacity-100' : 'opacity-0',
          fadeClassName,
        )}
      />
    </span>
  );
}
