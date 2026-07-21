import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import {
  ACTIONS,
  EVENTS,
  type EventData,
  Joyride,
  type Props as JoyrideProps,
  STATUS,
  type Step,
  type TooltipRenderProps,
} from 'react-joyride';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  useUpdateUserPreferences,
  useUserPreferences,
} from '@/features/preferences/useUserPreferences';
import { useGuidanceAcknowledgmentsStore } from './acknowledgmentsStore';
import { GuidanceContext } from './GuidanceContext';
import { useModalLayerStore } from './modalLayerStore';
import { contextualHintRegistry, guidedTourRegistry } from './registry';
import type { ContextualHintDefinition, GuidedTourDefinition } from './types';

type GuidanceSession =
  | { kind: 'hint'; definition: ContextualHintDefinition; started: boolean }
  | { kind: 'tour'; definition: GuidedTourDefinition; started: boolean };

const GUIDANCE_ACCENT = '#2563eb';
const DisableContextualHintsContext = createContext<(() => void) | null>(null);

const guidanceStyles = {
  floater: {
    filter: 'none',
  },
  tooltip: {
    backgroundColor: 'var(--popover)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) + 4px)',
    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.1)',
    color: 'var(--popover-foreground)',
    fontSize: 13,
    padding: '18px 18px 14px',
  },
  tooltipContainer: {
    lineHeight: 1.55,
    textAlign: 'left',
  },
  tooltipTitle: {
    fontSize: 16,
    fontWeight: 650,
    letterSpacing: '-0.012em',
    lineHeight: 1.25,
  },
  tooltipContent: {
    color: 'var(--muted-foreground)',
    paddingBottom: 16,
    paddingTop: 8,
  },
  tooltipFooter: {
    borderTop: '1px solid var(--border)',
    paddingTop: 12,
  },
  buttonPrimary: {
    backgroundColor: GUIDANCE_ACCENT,
    borderRadius: 'calc(var(--radius) - 2px)',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.18)',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.2,
    padding: '8px 13px',
  },
  buttonBack: {
    color: 'var(--muted-foreground)',
    fontSize: 13,
    fontWeight: 500,
  },
  buttonSkip: {
    color: 'var(--muted-foreground)',
    fontSize: 13,
  },
} satisfies NonNullable<JoyrideProps['styles']>;

function ContextualHintTooltip({
  primaryProps,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  const requestDisable = useContext(DisableContextualHintsContext);
  const { content, styles, title } = step;

  return (
    <div
      className="react-joyride__tooltip"
      style={styles.tooltip}
      {...tooltipProps}
      aria-describedby="joyride-tooltip-content"
      aria-label={title ? undefined : 'Contextual hint'}
      aria-labelledby={title ? 'joyride-tooltip-title' : undefined}
    >
      <div style={styles.tooltipContainer}>
        {title ? (
          <h4 id="joyride-tooltip-title" style={styles.tooltipTitle}>
            {title}
          </h4>
        ) : null}
        <div id="joyride-tooltip-content" style={styles.tooltipContent}>
          {content}
        </div>
      </div>
      <div style={styles.tooltipFooter}>
        <div style={styles.tooltipFooterSpacer}>
          <button
            type="button"
            className="rounded-md bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            onClick={requestDisable ?? undefined}
          >
            Disable Hints
          </button>
        </div>
        <button type="button" style={styles.buttonPrimary} {...primaryProps} />
      </div>
    </div>
  );
}

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
  const updatePreferences = useUpdateUserPreferences();
  const modalCount = useModalLayerStore((state) => state.count);
  const acknowledge = useGuidanceAcknowledgmentsStore((state) => state.acknowledge);
  const isAcknowledged = useGuidanceAcknowledgmentsStore((state) => state.isAcknowledged);
  const [session, setSession] = useState<GuidanceSession | null>(null);
  const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);
  const [disableConfirmationOpen, setDisableConfirmationOpen] = useState(false);
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
            placement: session.definition.placement ?? 'bottom',
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
  const requestDisableContextualHints = () => {
    setDisableConfirmationOpen(true);
  };
  const disableContextualHints = () => {
    updatePreferences.mutate({ contextual_hints_enabled: false });
    setSession(null);
    setDisableConfirmationOpen(false);
  };
  const guidanceVisible = session?.started && !disableConfirmationOpen;

  return (
    <GuidanceContext.Provider value={{ requestContextualHint, startGuidedTour }}>
      <DisableContextualHintsContext.Provider value={requestDisableContextualHints}>
        {children}
        <div
          ref={setPortalElement}
          aria-hidden={modalOpen}
          inert={modalOpen}
          className={guidanceVisible ? 'fixed inset-0 z-[100]' : 'relative z-[100]'}
          data-testid="guidance-portal"
        />
        {guidanceVisible && portalElement ? (
          <Joyride
            run
            continuous
            steps={steps}
            portalElement={portalElement}
            onEvent={handleEvent}
            locale={{ last: isHint ? 'Got it' : 'Done' }}
            styles={guidanceStyles}
            tooltipComponent={isHint ? ContextualHintTooltip : undefined}
            options={{
              arrowBase: 22,
              arrowColor: 'var(--popover)',
              arrowSize: 11,
              buttons: isHint ? ['primary'] : ['back', 'skip', 'primary'],
              blockTargetInteraction: true,
              disableFocusTrap: modalOpen,
              dismissKeyAction: false,
              offset: 14,
              overlayClickAction: false,
              overlayColor: 'rgba(15, 23, 42, 0.36)',
              primaryColor: GUIDANCE_ACCENT,
              scrollDuration: reducedMotion ? 0 : 300,
              skipBeacon: true,
              spotlightPadding: 6,
              spotlightRadius: 14,
              targetWaitTimeout: 3_000,
              textColor: 'var(--popover-foreground)',
              width: 360,
              zIndex: 1,
            }}
          />
        ) : null}
        <AlertDialog open={disableConfirmationOpen} onOpenChange={setDisableConfirmationOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disable contextual hints?</AlertDialogTitle>
              <AlertDialogDescription>
                Contextual hints will stop appearing. You can turn them back on or reset your hint
                history at any time in User Settings → Guidance.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep hints on</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={disableContextualHints}
              >
                Disable Hints
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DisableContextualHintsContext.Provider>
    </GuidanceContext.Provider>
  );
}
