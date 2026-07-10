import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
import { useHintsStore } from '@/stores/hintsStore';
import { getDocumentTarget } from '@/tutorials/documentationRegistry';
import { HintOverlay } from './HintOverlay';
import { useHintConditions } from './conditions';
import { selectEligibleHint, type ActiveHint } from './hintPolicy';
import { hintRegistry } from './hintRegistry';

const POLL_INTERVAL_MS = 400;

/**
 * Keeps polling from churning React state when the same hint still targets the
 * same element. Used only by `HintsController` before committing active state.
 * Used by: local callers in hints/HintsController module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
function sameActiveHint(left: ActiveHint | null, right: ActiveHint | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.hint.id === right.hint.id && left.target === right.target;
}

/**
 * Side-effect component: scrolls the target into view exactly when the active
 * hint identity (or its target element) changes \u2014 not on every poll tick.
 * Rendered by: `HintsController` so target scrolling is identity-driven and
 * remains separate from polling-based measurement.
 */
function ScrollEffect({ hintId, target }: { hintId: string; target: Element }) {
  useEffect(() => {
    if (typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        // jsdom or older browsers without options support — ignore.
      }
    }
  }, [hintId, target]);
  return null;
}

/**
 * Top-level controller for the contextual hints / coach-marks system.
 * Mount once near the root of the authenticated UI (e.g. inside
 * `WorkspaceShell`). Renders nothing until a registered hint becomes
 * eligible.
 * Rendered by: `WorkspaceShell` as the only contextual-hint runtime owner.
 * Flow: derive hint conditions, poll for an eligible anchor, suppress dismissed hints, scroll
 * the target once, and render highlight/bubble actions for the active hint.
 */
export function HintsController() {
  const { conditions, context } = useHintConditions();
  const {
    dismissedHints,
    hintsEnabled,
    sessionDismissedHints,
    dismissHint,
    dismissHintForSession,
    setLastUploadedFilePath,
  } = useHintsStore(
    useShallow((s) => ({
      dismissedHints: s.dismissedHints,
      hintsEnabled: s.hintsEnabled,
      sessionDismissedHints: s.sessionDismissedHints,
      dismissHint: s.dismissHint,
      dismissHintForSession: s.dismissHintForSession,
      setLastUploadedFilePath: s.setLastUploadedFilePath,
    })),
  );
  const openDocument = useUIStore((state) => state.openDocument);

  // `tick` forces re-evaluation of anchor resolution on a slow timer to pick
  // up DOM changes (route swaps, late-mounted rows in virtualized lists,
  // etc.) without wiring a MutationObserver across the entire document.
  const [tick, setTick] = useState(0);
  const [active, setActive] = useState<ActiveHint | null>(null);

  useEffect(() => {
    if (!hintsEnabled) return;

    /**
     * Picks the currently eligible hint and nudges overlays to remeasure.
     * Called by: the controller interval to refresh policy/anchor selection and
     * request one shared overlay measurement.
     */
    const syncActiveHint = () => {
      const next = selectEligibleHint({
        hints: hintRegistry,
        conditions,
        context,
        dismissedHints,
        sessionDismissedHints,
      });
      setActive((previous) => (sameActiveHint(previous, next) ? previous : next));
      setTick((t) => t + 1);
    };

    syncActiveHint();
    const id = window.setInterval(syncActiveHint, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [hintsEnabled, dismissedHints, sessionDismissedHints, conditions, context]);

  if (!hintsEnabled) return null;
  if (!active) return null;

  const { hint, target } = active;

  /**
   * Permanently dismisses a hint and clears upload state for upload-driven hints.
   * Called by: the hint bubble's permanent dismissal button.
   */
  const handleDismissPermanent = () => {
    dismissHint(hint.id);
    if (
      hint.condition === 'file-uploaded-not-added' ||
      hint.condition === 'file-uploaded-no-workspace'
    ) {
      setLastUploadedFilePath(null);
    }
  };
  /**
   * Session-dismisses a hint and clears upload state so it does not reopen.
   * Called by: the hint bubble's session dismissal button.
   */
  const handleDismissSession = () => {
    dismissHintForSession(hint.id);
    if (
      hint.condition === 'file-uploaded-not-added' ||
      hint.condition === 'file-uploaded-no-workspace'
    ) {
      // Stop the upload-tracker so the same hint doesn't immediately
      // re-trigger after the user closed it for the session.
      setLastUploadedFilePath(null);
    }
  };
  const learnMoreTarget = hint.learnMoreTarget;
  const handleLearnMore = learnMoreTarget
    ? () => {
        const documentTarget = getDocumentTarget('tutorial', learnMoreTarget);
        if (documentTarget) openDocument(documentTarget);
      }
    : undefined;

  return (
    <>
      <ScrollEffect hintId={hint.id} target={target} />
      <HintOverlay
        hint={hint}
        target={target}
        measurementRevision={tick}
        onDismissPermanent={handleDismissPermanent}
        onDismissSession={handleDismissSession}
        onLearnMore={handleLearnMore}
      />
    </>
  );
}
