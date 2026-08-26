import { useEffect, useRef, useState } from 'react';

import type { RowDetailNavigation, RowDetailPayload } from './RowDetailPanel';

type NavigationDirection = 'previous' | 'next';

interface RowDetailSelection<T> {
  item: T;
  index: number;
  page: number;
  payload: RowDetailPayload;
}

interface PendingNavigation<T> {
  direction: NavigationDirection;
  targetPage: number;
  origin: RowDetailSelection<T>;
  phase: 'search' | 'restore';
  failure: boolean;
}

export interface UseRowDetailDialogOptions<T> {
  /** Stable identity for the result ordering, excluding the current page. */
  sequenceKey: string;
  /** Displayed rows on the currently loaded server page. */
  items: readonly T[];
  /** One-based page represented by `items`. */
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  loading: boolean;
  error?: unknown;
  onPageChange: (page: number) => void;
  toPayload: (item: T) => RowDetailPayload;
}

/**
 * Owns selection and transparent cross-page navigation for RowDetailPanel.
 * The table remains the authority for paging while the hook skips empty pages
 * and restores the origin after an exhausted or failed scan.
 */
export function useRowDetailDialog<T>({
  sequenceKey,
  items,
  page,
  hasPreviousPage,
  hasNextPage,
  loading,
  error,
  onPageChange,
  toPayload,
}: UseRowDetailDialogOptions<T>) {
  const [selection, setSelection] = useState<RowDetailSelection<T> | null>(null);
  const [detailOpen, setDetailOpenState] = useState(false);
  const [pending, setPending] = useState<PendingNavigation<T> | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState<Record<NavigationDirection, boolean>>({
    previous: false,
    next: false,
  });
  const requestedPageRef = useRef<number | null>(null);
  const sequenceKeyRef = useRef(sequenceKey);

  const selectItem = (item: T, index: number, selectedPage: number) => {
    setSelection({ item, index, page: selectedPage, payload: toPayload(item) });
    setExhausted({ previous: false, next: false });
    setNavigationError(null);
  };

  const openDetailAt = (index: number) => {
    const item = items[index];
    if (item === undefined) return;
    requestedPageRef.current = null;
    setPending(null);
    selectItem(item, index, page);
    setDetailOpenState(true);
  };

  const requestAdjacentPage = (direction: NavigationDirection, origin: RowDetailSelection<T>) => {
    requestedPageRef.current = null;
    setNavigationError(null);
    setPending({
      direction,
      targetPage: origin.page + (direction === 'next' ? 1 : -1),
      origin,
      phase: 'search',
      failure: false,
    });
  };

  const goPrevious = () => {
    if (!selection || pending) return;
    if (selection.page === page && selection.index > 0) {
      const item = items[selection.index - 1];
      if (item !== undefined) selectItem(item, selection.index - 1, page);
      return;
    }
    if (!exhausted.previous && selection.page > 1) requestAdjacentPage('previous', selection);
  };

  const goNext = () => {
    if (!selection || pending) return;
    if (selection.page === page && selection.index < items.length - 1) {
      const item = items[selection.index + 1];
      if (item !== undefined) selectItem(item, selection.index + 1, page);
      return;
    }
    if (!exhausted.next && hasNextPage) requestAdjacentPage('next', selection);
  };

  const setDetailOpen = (open: boolean) => {
    if (!open && pending) onPageChange(pending.origin.page);
    if (!open) {
      requestedPageRef.current = null;
      setPending(null);
      setNavigationError(null);
    }
    setDetailOpenState(open);
  };

  // Page is deliberately excluded from sequenceKey by callers.
  useEffect(() => {
    if (sequenceKeyRef.current === sequenceKey) return;
    sequenceKeyRef.current = sequenceKey;
    requestedPageRef.current = null;
    setSelection(null);
    setPending(null);
    setNavigationError(null);
    setExhausted({ previous: false, next: false });
    setDetailOpenState(false);
  }, [sequenceKey]);

  // Dispatch each requested page once even if callback identity changes.
  useEffect(() => {
    if (!pending || requestedPageRef.current === pending.targetPage) return;
    requestedPageRef.current = pending.targetPage;
    onPageChange(pending.targetPage);
  }, [onPageChange, pending]);

  useEffect(() => {
    if (!pending || loading || page !== pending.targetPage) return;
    const frame = requestAnimationFrame(() => {
      if (pending.phase === 'restore') {
        requestedPageRef.current = null;
        setPending(null);
        if (pending.failure) {
          setNavigationError(
            `Could not load the ${pending.direction === 'next' ? 'next' : 'previous'} row.`,
          );
        } else {
          setExhausted((current) => ({ ...current, [pending.direction]: true }));
        }
        return;
      }

      if (error) {
        if (page === pending.origin.page) {
          requestedPageRef.current = null;
          setPending(null);
          setNavigationError(
            `Could not load the ${pending.direction === 'next' ? 'next' : 'previous'} row.`,
          );
          return;
        }
        requestedPageRef.current = null;
        setPending({
          ...pending,
          targetPage: pending.origin.page,
          phase: 'restore',
          failure: true,
        });
        return;
      }

      if (items.length > 0) {
        const index = pending.direction === 'next' ? 0 : items.length - 1;
        const item = items[index];
        if (item !== undefined) {
          setSelection({ item, index, page, payload: toPayload(item) });
          setExhausted({ previous: false, next: false });
          setNavigationError(null);
          requestedPageRef.current = null;
          setPending(null);
        }
        return;
      }

      const canContinue = pending.direction === 'next' ? hasNextPage : hasPreviousPage;
      if (canContinue) {
        requestedPageRef.current = null;
        setPending({
          ...pending,
          targetPage: page + (pending.direction === 'next' ? 1 : -1),
        });
        return;
      }

      if (page === pending.origin.page) {
        requestedPageRef.current = null;
        setPending(null);
        setExhausted((current) => ({ ...current, [pending.direction]: true }));
        return;
      }
      requestedPageRef.current = null;
      setPending({
        ...pending,
        targetPage: pending.origin.page,
        phase: 'restore',
        failure: false,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [error, hasNextPage, hasPreviousPage, items, loading, page, pending, toPayload]);

  const selectionOnCurrentPage = selection?.page === page;
  const canPrevious = Boolean(
    selection &&
      !pending &&
      !exhausted.previous &&
      ((selectionOnCurrentPage && selection.index > 0) || selection.page > 1),
  );
  const canNext = Boolean(
    selection &&
      !pending &&
      !exhausted.next &&
      ((selectionOnCurrentPage && selection.index < items.length - 1) || hasNextPage),
  );

  const navigation: RowDetailNavigation = {
    canPrevious,
    canNext,
    pendingDirection: pending?.direction ?? null,
    error: navigationError,
    onPrevious: goPrevious,
    onNext: goNext,
  };

  return {
    detailPayload: selection?.payload ?? null,
    selectedItem: selection?.item ?? null,
    detailOpen,
    setDetailOpen,
    openDetailAt,
    navigation,
  };
}
