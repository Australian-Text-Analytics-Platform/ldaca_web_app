import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useReducer,
  useState,
} from 'react';
import {
  ACTIONS,
  EVENTS,
  type EventData,
  Joyride,
  ORIGIN,
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
import type { ViewType } from '@/features/views/viewIds';
import { useGuidanceAcknowledgmentsStore } from './acknowledgmentsStore';
import {
  contextualHintVisitReducer,
  initialContextualHintVisitState,
  selectContextualHintCandidates,
} from './contextualHintVisitState';
import { GuidanceContext } from './GuidanceContext';
import { useModalLayerStore } from './modalLayerStore';
import {
  contextualHintRegistry,
  contextualHintSequences as productionContextualHintSequences,
  guidedTourRegistry,
} from './registry';
import type { ContextualHintDefinition, GuidedTourDefinition } from './types';

type GuidanceSession =
  | {
      kind: 'hint';
      view: ViewType;
      definition: ContextualHintDefinition;
      started: boolean;
    }
  | { kind: 'tour'; definition: GuidedTourDefinition; started: boolean };

const GUIDANCE_ACCENT = '#2563eb';
const DisableContextualHintsContext = createContext<(() => void) | null>(null);

const guidanceStyles = {
  floater: { filter: 'none' },
  tooltip: {
    backgroundColor: 'var(--popover)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) + 4px)',
    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.1)',
    color: 'var(--popover-foreground)',
    fontSize: 13,
    maxWidth: 'calc(100vw - 24px)',
    padding: '18px 18px 14px',
  },
  tooltipContainer: { lineHeight: 1.55, textAlign: 'left' },
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
  tooltipFooter: { borderTop: '1px solid var(--border)', paddingTop: 12 },
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
    padding: '8px 6px',
  },
  buttonSkip: { color: 'var(--muted-foreground)', fontSize: 13 },
} satisfies NonNullable<JoyrideProps['styles']>;

function ContextualHintTooltip({
  closeProps,
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
      <div style={styles.tooltipFooter} className="flex flex-wrap items-center gap-3">
        <div style={styles.tooltipFooterSpacer}>
          <button
            type="button"
            className="rounded-md bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            onClick={requestDisable ?? undefined}
          >
            Disable Hints
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" style={styles.buttonBack} {...closeProps} />
          <button type="button" style={styles.buttonPrimary} {...primaryProps} />
        </div>
        <p className="order-last w-full text-right text-[11px] text-muted-foreground">
          Esc = Not now · Enter = Got it
        </p>
      </div>
    </div>
  );
}

export interface GuidanceProviderProps {
  children: ReactNode;
  contextualHints?: readonly ContextualHintDefinition[];
  contextualHintSequences?: Parameters<typeof selectContextualHintCandidates>[1];
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

function GuidancePresentationBoundary({ children }: { children: ReactNode }) {
  const [started, setStarted] = useState(() => useModalLayerStore.getState().count === 0);

  useEffect(
    () =>
      useModalLayerStore.subscribe((state) => {
        if (state.count === 0) setStarted(true);
      }),
    [],
  );

  return started ? children : null;
}

export function GuidanceProvider({
  children,
  contextualHints = contextualHintRegistry,
  contextualHintSequences = productionContextualHintSequences,
  guidedTours = guidedTourRegistry,
}: GuidanceProviderProps) {
  const userId = useAuth().user?.id ?? null;
  const { data: preferences } = useUserPreferences();
  const updatePreferences = useUpdateUserPreferences();
  const modalCount = useModalLayerStore((state) => state.count);
  const acknowledge = useGuidanceAcknowledgmentsStore((state) => state.acknowledge);
  const acknowledgments = useGuidanceAcknowledgmentsStore((state) =>
    userId ? state.byUser[userId] : undefined,
  );
  const [visitState, dispatchContextualHintVisit] = useReducer(
    contextualHintVisitReducer,
    initialContextualHintVisitState,
  );
  const [tourSession, setTourSession] = useState<Extract<GuidanceSession, { kind: 'tour' }> | null>(
    null,
  );
  const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);
  const [disableConfirmationOpen, setDisableConfirmationOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const contextualHintsEnabled = preferences?.contextual_hints_enabled === true;

  const candidateIds = selectContextualHintCandidates(visitState, contextualHintSequences);
  const nextDefinition = candidateIds
    .map((id) => contextualHints.find((definition) => definition.id === id))
    .find(
      (definition): definition is ContextualHintDefinition =>
        definition !== undefined &&
        (acknowledgments?.[definition.id] ?? 0) < definition.version,
    );

  const hintSession: GuidanceSession | null =
    userId &&
    contextualHintsEnabled &&
    visitState.activeView &&
    !visitState.paused &&
    nextDefinition
      ? {
          kind: 'hint',
          view: visitState.activeView,
          definition: nextDefinition,
          started: modalCount === 0,
        }
      : null;
  const session: GuidanceSession | null = tourSession
    ? { ...tourSession, started: modalCount === 0 }
    : hintSession;
  const sessionKey = session
    ? `${session.kind}:${session.definition.id}${session.kind === 'hint' ? `:${String(session.definition.version)}` : ''}`
    : null;

  const startGuidedTour = (id: string) => {
    const definition = guidedTours.find((candidate) => candidate.id === id);
    if (!definition) return;
    setTourSession((current) => current ?? { kind: 'tour', definition, started: true });
  };

  const acknowledgeCurrentHint = () => {
    if (session?.kind !== 'hint' || !userId) return;
    acknowledge(userId, session.definition.id, session.definition.version);
    dispatchContextualHintVisit({
      type: 'acknowledge',
      view: session.view,
      id: session.definition.id,
    });
  };

  const deferCurrentHint = () => {
    if (session?.kind !== 'hint') return;
    dispatchContextualHintVisit({
      type: 'defer',
      view: session.view,
    });
  };

  const pauseCurrentHint = (type: 'target-missing' | 'hints-disabled') => {
    if (session?.kind !== 'hint') return;
    dispatchContextualHintVisit({ type, view: session.view });
  };

  const steps: Step[] =
    session?.kind === 'hint'
      ? [
          {
            id: session.definition.id,
            target: session.definition.target,
            title: session.definition.title,
            content: session.definition.content,
            placement: session.definition.placement ?? 'auto',
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
      pauseCurrentHint('target-missing');
      return;
    }
    if (
      session?.kind === 'hint' &&
      (event.action === ACTIONS.CLOSE ||
        event.origin === ORIGIN.BUTTON_CLOSE ||
        event.origin === ORIGIN.KEYBOARD)
    ) {
      deferCurrentHint();
      return;
    }
    if (
      session?.kind === 'hint' &&
      (event.action === ACTIONS.NEXT || event.origin === ORIGIN.BUTTON_PRIMARY)
    ) {
      acknowledgeCurrentHint();
      return;
    }
    if (session?.kind === 'hint' && event.type === EVENTS.TOUR_END) {
      // Joyride can normalize the final event to action "update" and clear its
      // origin. The preceding close/next event owns the user intent, so an
      // origin-less tour end must not acknowledge a Contextual Hint.
      return;
    }
    if (
      event.type === EVENTS.TOUR_END ||
      event.status === STATUS.SKIPPED ||
      event.action === ACTIONS.SKIP
    ) {
      setTourSession(null);
    }
  };

  const modalOpen = modalCount > 0;
  const isHint = session?.kind === 'hint';
  const requestDisableContextualHints = () => {
    setDisableConfirmationOpen(true);
  };
  const disableContextualHints = () => {
    updatePreferences.mutate({ contextual_hints_enabled: false });
    if (session?.kind === 'hint') {
      pauseCurrentHint('hints-disabled');
    }
    setTourSession(null);
    setDisableConfirmationOpen(false);
  };
  const guidanceInteractive = Boolean(session) && !modalOpen && !disableConfirmationOpen;

  useEffect(() => {
    if (!guidanceInteractive || session?.kind !== 'hint' || !userId) return;

    const acknowledgeWithEnter = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.repeat) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('button, input, select, textarea, a[href]'))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      acknowledgeCurrentHint();
    };

    window.addEventListener('keydown', acknowledgeWithEnter, true);
    return () => {
      window.removeEventListener('keydown', acknowledgeWithEnter, true);
    };
  });

  return (
    <GuidanceContext.Provider value={{ dispatchContextualHintVisit, startGuidedTour }}>
      <DisableContextualHintsContext.Provider value={requestDisableContextualHints}>
        {children}
        <div
          ref={setPortalElement}
          aria-hidden={modalOpen}
          inert={modalOpen}
          className={session ? 'fixed inset-0 z-[100]' : 'relative z-[100]'}
          data-testid="guidance-portal"
        />
        {session && sessionKey && portalElement ? (
          <GuidancePresentationBoundary key={sessionKey}>
            {disableConfirmationOpen ? null : (
              <Joyride
            run
            continuous
            steps={steps}
            portalElement={portalElement}
            onEvent={handleEvent}
            locale={{ close: 'Not now', last: isHint ? 'Got it' : 'Done' }}
            styles={guidanceStyles}
            tooltipComponent={isHint ? ContextualHintTooltip : undefined}
            options={{
              arrowBase: 22,
              arrowColor: 'var(--popover)',
              arrowSize: 11,
              buttons: isHint ? ['primary'] : ['back', 'skip', 'primary'],
              blockTargetInteraction: true,
              disableFocusTrap: modalOpen,
              dismissKeyAction: isHint ? 'close' : false,
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
            )}
          </GuidancePresentationBoundary>
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
