import { useEffect, useState, type ReactNode } from 'react';
import { ACTIONS, EVENTS, Joyride, STATUS, type EventData, type Step } from 'react-joyride';

import { useAuth } from '@/features/auth/hooks/useAuth';
import { useUserPreferences } from '@/features/preferences/useUserPreferences';
import { useGuidanceAcknowledgmentsStore } from './acknowledgmentsStore';
import { useModalLayerStore } from './modalLayerStore';
import { contextualHintRegistry, guidedTourRegistry } from './registry';
import type { ContextualHintDefinition, GuidedTourDefinition } from './types';
import { GuidanceContext } from './GuidanceContext';

type GuidanceSession =
  | { kind: 'hint'; definition: ContextualHintDefinition; started: boolean }
  | { kind: 'tour'; definition: GuidedTourDefinition; started: boolean };

export interface GuidanceProviderProps {
  children: ReactNode;
  contextualHints?: readonly ContextualHintDefinition[];
  guidedTours?: readonly GuidedTourDefinition[];
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReduced(query.matches);
    };
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  return reduced;
}

export function GuidanceProvider({
  children,
  contextualHints = contextualHintRegistry,
  guidedTours = guidedTourRegistry,
}: GuidanceProviderProps) {
  const userId = useAuth().user?.id ?? null;
  const { data: preferences } = useUserPreferences();
  const modalCount = useModalLayerStore((state) => state.count);
  const acknowledge = useGuidanceAcknowledgmentsStore((state) => state.acknowledge);
  const isAcknowledged = useGuidanceAcknowledgmentsStore((state) => state.isAcknowledged);
  const [session, setSession] = useState<GuidanceSession | null>(null);
  const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const contextualHintsEnabled = preferences?.contextual_hints_enabled === true;
  const [previousContextualHintsEnabled, setPreviousContextualHintsEnabled] =
    useState(contextualHintsEnabled);

  if (previousContextualHintsEnabled !== contextualHintsEnabled) {
    setPreviousContextualHintsEnabled(contextualHintsEnabled);
    if (!contextualHintsEnabled && session?.kind === 'hint') {
      setSession(null);
    }
  }

  useEffect(() => {
    return useModalLayerStore.subscribe((current, previous) => {
      if (previous.count > 0 && current.count === 0) {
        setSession((active) => (active && !active.started ? { ...active, started: true } : active));
      }
    });
  }, []);

  const requestContextualHint = (id: string) => {
    if (!userId || !contextualHintsEnabled) return;
    const definition = contextualHints.find((candidate) => candidate.id === id);
    if (!definition || isAcknowledged(userId, definition.id, definition.version)) return;
    setSession((current) => current ?? { kind: 'hint', definition, started: modalCount === 0 });
  };

  const startGuidedTour = (id: string) => {
    const definition = guidedTours.find((candidate) => candidate.id === id);
    if (!definition) return;
    setSession((current) => current ?? { kind: 'tour', definition, started: modalCount === 0 });
  };

  const steps: Step[] =
    session?.kind === 'hint'
      ? [
          {
            id: session.definition.id,
            target: session.definition.target,
            title: session.definition.title,
            content: session.definition.content,
          },
        ]
      : (session?.definition.steps.map((step) => ({
          id: step.id,
          target: step.target,
          title: step.title,
          content: step.content,
        })) ?? []);

  const handleEvent = (event: EventData) => {
    if (event.type === EVENTS.TARGET_NOT_FOUND) {
      setSession(null);
      return;
    }
    if (
      session?.kind === 'hint' &&
      userId &&
      event.type === EVENTS.TOUR_END &&
      event.status === STATUS.FINISHED
    ) {
      acknowledge(userId, session.definition.id, session.definition.version);
      setSession(null);
      return;
    }
    if (
      event.type === EVENTS.TOUR_END ||
      event.status === STATUS.SKIPPED ||
      event.action === ACTIONS.SKIP
    ) {
      setSession(null);
    }
  };

  const modalOpen = modalCount > 0;
  const isHint = session?.kind === 'hint';

  return (
    <GuidanceContext.Provider value={{ requestContextualHint, startGuidedTour }}>
      {children}
      <div
        ref={setPortalElement}
        aria-hidden={modalOpen}
        inert={modalOpen}
        className="relative z-40"
        data-testid="guidance-portal"
      />
      {session?.started && portalElement ? (
        <Joyride
          run
          continuous
          steps={steps}
          portalElement={portalElement}
          onEvent={handleEvent}
          locale={{ last: isHint ? 'Got it' : 'Done' }}
          options={{
            buttons: isHint ? ['primary'] : ['back', 'skip', 'primary'],
            blockTargetInteraction: true,
            disableFocusTrap: modalOpen,
            dismissKeyAction: false,
            overlayClickAction: false,
            scrollDuration: reducedMotion ? 0 : 300,
            skipBeacon: true,
            targetWaitTimeout: 3_000,
            zIndex: 1,
          }}
        />
      ) : null}
    </GuidanceContext.Provider>
  );
}
