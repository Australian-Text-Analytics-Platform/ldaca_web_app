import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
import { useHintsStore } from '@/stores/hintsStore';
import { getTutorialTarget } from '@/tutorials/tutorialRegistry';
import { HighlightRing } from './HighlightRing';
import { HintBubble } from './HintBubble';
import { useHintConditions } from './conditions';
import { hintRegistry } from './hintRegistry';
import type { HintDefinition, HintResolverContext } from './types';

const POLL_INTERVAL_MS = 400;

const orderedHintRegistry = [...hintRegistry]
  .map((hint, index) => ({ hint, index }))
  .sort(
    (left, right) =>
      (left.hint.priority ?? 100) - (right.hint.priority ?? 100) || left.index - right.index,
  )
  .map(({ hint }) => hint);

/**
 * Resolves the DOM element a hint should point at. It exists so registry
 * entries can either provide dynamic anchor logic or use the shared
 * `data-hint-id` convention consumed by `pickActiveHint`.
 * Used by: local callers in hints/HintsController module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
function resolveAnchor(hint: HintDefinition, ctx: HintResolverContext): Element | null {
  if (hint.resolveAnchor) return hint.resolveAnchor(ctx);
  if (!hint.anchorHintId) return null;
  return document.querySelector(`[data-hint-id="${CSS.escape(hint.anchorHintId)}"]`);
}

/**
 * Chooses the first eligible hint for the current app state. The controller
 * calls this on render/poll ticks to combine condition flags, dismissal state,
 * and live DOM availability into a single active coach mark.
 * Used by: local callers in hints/HintsController module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Flow: walk hints in registry order, skip dismissed or inactive conditions, resolve the DOM anchor, and return the first visible target.
 */
function pickActiveHint(
  conditions: ReturnType<typeof useHintConditions>['conditions'],
  context: HintResolverContext,
  dismissedPersistent: ReadonlySet<string>,
  sessionDismissed: ReadonlySet<string>,
): { hint: HintDefinition; target: Element } | null {
  for (const hint of orderedHintRegistry) {
    if (dismissedPersistent.has(hint.id)) continue;
    if (sessionDismissed.has(hint.id)) continue;
    if (!conditions[hint.condition]) continue;
    const target = resolveAnchor(hint, context);
    if (!target) continue;
    return { hint, target };
  }
  return null;
}

/**
 * Keeps polling from churning React state when the same hint still targets the
 * same element. Used only by `HintsController` before committing active state.
 * Used by: local callers in hints/HintsController module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
function sameActiveHint(
  left: { hint: HintDefinition; target: Element } | null,
  right: { hint: HintDefinition; target: Element } | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.hint.id === right.hint.id && left.target === right.target;
}

/**
 * Side-effect component: scrolls the target into view exactly when the active
 * hint identity (or its target element) changes \u2014 not on every poll tick.
 * Rendered by: hints/HintsController module JSX because the parent needs this component boundary to keep feature controls and state presentation isolated.
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
 * Rendered by: App module, HighlightRing module, conditions module (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: derive hint conditions, poll for an eligible anchor, suppress dismissed hints, scroll
 * the target once, and render highlight/bubble actions for the active hint.
 */
export function HintsController() {
  const { conditions, context } = useHintConditions();
  const { dismissedHints, hintsEnabled, dismissHint } = useHintsStore(
    useShallow((s) => ({
      dismissedHints: s.dismissedHints,
      hintsEnabled: s.hintsEnabled,
      dismissHint: s.dismissHint,
    })),
  );
  const { sessionDismissedHints, sessionDismissHint, openModal, setLastUploadedFilePath } =
    useUIStore(
      useShallow((s) => ({
        sessionDismissedHints: s.sessionDismissedHints,
        sessionDismissHint: s.sessionDismissHint,
        openModal: s.openModal,
        setLastUploadedFilePath: s.setLastUploadedFilePath,
      })),
    );

  // `tick` forces re-evaluation of anchor resolution on a slow timer to pick
  // up DOM changes (route swaps, late-mounted rows in virtualized lists,
  // etc.) without wiring a MutationObserver across the entire document.
  const [tick, setTick] = useState(0);
  const [active, setActive] = useState<{ hint: HintDefinition; target: Element } | null>(null);

  useEffect(() => {
    if (!hintsEnabled) return;

    /**
     * Picks the currently eligible hint and nudges overlays to remeasure.
     * Called by: HintsController internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
     */
    const syncActiveHint = () => {
      const persistent = new Set(dismissedHints);
      const next = pickActiveHint(conditions, context, persistent, sessionDismissedHints);
      setActive((previous) => (sameActiveHint(previous, next) ? previous : next));
      setTick((t) => t + 1);
    };

    syncActiveHint();
    const id = window.setInterval(syncActiveHint, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [hintsEnabled, dismissedHints, sessionDismissedHints, conditions, context]);

  if (!hintsEnabled) return null;
  if (!active) return null;

  const { hint, target } = active;

  /**
   * Permanently dismisses a hint and clears upload state for upload-driven hints.
   * Called by: HintsController internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
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
   * Called by: HintsController internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleDismissSession = () => {
    sessionDismissHint(hint.id);
    if (
      hint.condition === 'file-uploaded-not-added' ||
      hint.condition === 'file-uploaded-no-workspace'
    ) {
      // Stop the upload-tracker so the same hint doesn't immediately
      // re-trigger after the user closed it for the session.
      setLastUploadedFilePath(null);
    }
  };
  const handleLearnMore = hint.learnMoreTarget
    ? () => {
        const target = getTutorialTarget(hint.learnMoreTarget!);
        if (target) openModal('tutorial', target);
      }
    : undefined;
  const handleAction = hint.action
    ? () => {
        hint.action?.run();
        sessionDismissHint(hint.id);
      }
    : undefined;

  return (
    <>
      <ScrollEffect hintId={hint.id} target={target} />
      <HighlightRing target={target} tick={tick} />
      <HintBubble
        hint={hint}
        target={target}
        tick={tick}
        onDismissPermanent={handleDismissPermanent}
        onDismissSession={handleDismissSession}
        onLearnMore={handleLearnMore}
        onAction={handleAction}
      />
    </>
  );
}

export default HintsController;
