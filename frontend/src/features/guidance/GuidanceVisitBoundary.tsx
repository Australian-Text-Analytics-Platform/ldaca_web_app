import { type ReactNode, useEffect } from 'react';

import type { ViewType } from '@/features/views/viewIds';
import { GuidanceVisitContext, useGuidanceInfrastructure } from './GuidanceContext';

interface GuidanceVisitBoundaryProps {
  children: ReactNode;
  view: ViewType;
}

/** Defines one sidebar-function visit without resetting on persisted Analysis Tab changes. */
export function GuidanceVisitBoundary({ children, view }: GuidanceVisitBoundaryProps) {
  const { dispatchContextualHintVisit } = useGuidanceInfrastructure();

  useEffect(() => {
    dispatchContextualHintVisit({ type: 'begin-view', view });
    return () => {
      dispatchContextualHintVisit({ type: 'end-view', view });
    };
  }, [dispatchContextualHintVisit, view]);

  return <GuidanceVisitContext.Provider value={view}>{children}</GuidanceVisitContext.Provider>;
}
