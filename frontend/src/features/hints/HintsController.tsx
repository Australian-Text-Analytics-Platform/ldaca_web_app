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

function resolveAnchor(
  hint: HintDefinition,
  ctx: HintResolverContext,
): Element | null {
  if (hint.resolveAnchor) return hint.resolveAnchor(ctx);
  if (!hint.anchorHintId) return null;
  return document.querySelector(
    `[data-hint-id="${CSS.escape(hint.anchorHintId)}"]`,
  );
}

function pickActiveHint(
  conditions: ReturnType<typeof useHintConditions>['conditions'],
  context: HintResolverContext,
  dismissedPersistent: ReadonlySet<string>,
  sessionDismissed: ReadonlySet<string>,
): { hint: HintDefinition; target: Element } | null {
  // Sort by priority (lower first), preserving registry order on ties.
  const ordered = [...hintRegistry]
    .map((h, idx) => ({ h, idx }))
    .sort(
      (a, b) =>
        (a.h.priority ?? 100) - (b.h.priority ?? 100) || a.idx - b.idx,
    )
    .map(({ h }) => h);

  for (const hint of ordered) {
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
 * Side-effect component: scrolls the target into view exactly when the active
 * hint identity (or its target element) changes \u2014 not on every poll tick.
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
 */
export const HintsController: React.FC = () => {
  const { conditions, context } = useHintConditions();
  const { dismissedHints, hintsEnabled, dismissHint } = useHintsStore(
    useShallow((s) => ({
      dismissedHints: s.dismissedHints,
      hintsEnabled: s.hintsEnabled,
      dismissHint: s.dismissHint,
    })),
  );
  const { sessionDismissedHints, sessionDismissHint, openTutorialTarget, setLastUploadedFilePath } =
    useUIStore(
      useShallow((s) => ({
        sessionDismissedHints: s.sessionDismissedHints,
        sessionDismissHint: s.sessionDismissHint,
        openTutorialTarget: s.openTutorialTarget,
        setLastUploadedFilePath: s.setLastUploadedFilePath,
      })),
    );

  // `tick` forces re-evaluation of anchor resolution on a slow timer to pick
  // up DOM changes (route swaps, late-mounted rows in virtualized lists,
  // etc.) without wiring a MutationObserver across the entire document.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hintsEnabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [hintsEnabled]);

  // Expose a small debug helper so authors can introspect from DevTools:
  //   window.__ldacaHints.debug()
  //   window.__ldacaHints.reset()
  useEffect(() => {
    const w = window as unknown as { __ldacaHints?: unknown };
    w.__ldacaHints = {
      debug: () => {
        const persistent = new Set(useHintsStore.getState().dismissedHints);
        const session = useUIStore.getState().sessionDismissedHints;
        const picked = pickActiveHint(conditions, context, persistent, session);
        return {
          hintsEnabled: useHintsStore.getState().hintsEnabled,
          dismissedHints: useHintsStore.getState().dismissedHints,
          sessionDismissed: Array.from(session),
          lastUploadedFilePath: useUIStore.getState().lastUploadedFilePath,
          currentConditions: conditions,
          pickedHintId: picked?.hint.id ?? null,
          registryEvaluation: hintRegistry.map((h) => ({
            id: h.id,
            condition: h.condition,
            conditionTrue: conditions[h.condition],
            dismissed: persistent.has(h.id),
            sessionDismissed: session.has(h.id),
            anchorFound: !!(h.resolveAnchor
              ? h.resolveAnchor(context)
              : h.anchorHintId
                ? document.querySelector(`[data-hint-id="${CSS.escape(h.anchorHintId)}"]`)
                : null),
          })),
        };
      },
      reset: () => {
        useHintsStore.getState().resetHints();
        // eslint-disable-next-line no-console
        console.info('[ldaca-hints] dismissals cleared');
      },
    };
    return () => {
      delete (w as { __ldacaHints?: unknown }).__ldacaHints;
    };
  }, [conditions, context]);

  if (!hintsEnabled) return null;

  const persistentSet = new Set(dismissedHints);
  const active = pickActiveHint(
    conditions,
    context,
    persistentSet,
    sessionDismissedHints,
  );
  if (!active) return null;

  const { hint, target } = active;

  const handleDismissPermanent = () => {
    dismissHint(hint.id);
    if (
      hint.condition === 'file-uploaded-not-added' ||
      hint.condition === 'file-uploaded-no-workspace'
    ) {
      setLastUploadedFilePath(null);
    }
  };
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
        if (target) openTutorialTarget(target);
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
};

export default HintsController;
