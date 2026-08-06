import { useContext, useEffect, useId, useRef } from 'react';

import { GuidanceVisitContext, useGuidanceInfrastructure } from './GuidanceContext';

const sameIds = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

/** Publishes state-derived, ordered milestones for the active function visit. */
export function useProgressiveContextualHints(eligibleHintIds: readonly string[]) {
  const view = useContext(GuidanceVisitContext);
  const sourceId = useId();
  const lastPublished = useRef<readonly string[]>([]);
  const { dispatchContextualHintVisit } = useGuidanceInfrastructure();

  useEffect(() => {
    if (!view || sameIds(lastPublished.current, eligibleHintIds)) return;
    lastPublished.current = [...eligibleHintIds];
    dispatchContextualHintVisit({
      type: 'register',
      sourceId,
      view,
      ids: eligibleHintIds,
    });
  });

  useEffect(() => {
    return () => {
      // Strict Mode replays effect setup after cleanup in development. Reset
      // the publication guard so the replay restores the registration.
      lastPublished.current = [];
      dispatchContextualHintVisit({ type: 'unregister', sourceId });
    };
  }, [dispatchContextualHintVisit, sourceId]);
}
