import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  EVENTS,
  ORIGIN,
  type Props as JoyrideProps,
  STATUS,
  type TooltipRenderProps,
} from 'react-joyride';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGuidanceAcknowledgmentsStore } from '../acknowledgmentsStore';
import { useGuidance } from '../GuidanceContext';
import { GuidanceProvider } from '../GuidanceProvider';
import { GuidanceVisitBoundary } from '../GuidanceVisitBoundary';
import { useModalLayerStore } from '../modalLayerStore';
import type { ContextualHintDefinition, GuidedTourDefinition } from '../types';
import { useProgressiveContextualHints } from '../useProgressiveContextualHints';

const fixture = vi.hoisted(() => ({
  enabled: true,
  joyrideProps: null as JoyrideProps | null,
  updatePreferences: vi.fn(),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/features/preferences/useUserPreferences', () => ({
  useUserPreferences: () => ({ data: { contextual_hints_enabled: fixture.enabled } }),
  useUpdateUserPreferences: () => ({ mutate: fixture.updatePreferences }),
}));

vi.mock('react-joyride', () => ({
  ACTIONS: { CLOSE: 'close', NEXT: 'next', SKIP: 'skip' },
  EVENTS: {
    STEP_AFTER: 'step:after',
    TARGET_NOT_FOUND: 'error:target_not_found',
    TOUR_END: 'tour:end',
  },
  ORIGIN: {
    BUTTON_CLOSE: 'button_close',
    BUTTON_PRIMARY: 'button_primary',
    KEYBOARD: 'keyboard',
  },
  STATUS: { FINISHED: 'finished', SKIPPED: 'skipped' },
  Joyride: (props: JoyrideProps) => {
    fixture.joyrideProps = props;
    const TooltipComponent = props.tooltipComponent;
    const finish = (origin: string, action: string) => {
      props.onEvent?.(
        {
          action,
          origin,
          status: 'running',
          type: 'step:after',
        } as Parameters<NonNullable<JoyrideProps['onEvent']>>[0],
        {} as Parameters<NonNullable<JoyrideProps['onEvent']>>[1],
      );
      props.onEvent?.(
        {
          action: 'update',
          origin: null,
          status: 'finished',
          type: 'tour:end',
        } as Parameters<NonNullable<JoyrideProps['onEvent']>>[0],
        {} as Parameters<NonNullable<JoyrideProps['onEvent']>>[1],
      );
    };
    const tooltipProps = {
      backProps: {},
      closeProps: {
        children: 'Not now',
        onClick: () => finish('button_close', 'close'),
      },
      continuous: true,
      controls: {},
      index: 0,
      isLastStep: true,
      primaryProps: {
        children: 'Got it',
        onClick: () => finish('button_primary', 'next'),
      },
      size: 1,
      skipProps: {},
      step: {
        ...props.steps[0],
        buttons: props.options?.buttons ?? ['primary'],
        styles: { ...props.styles, tooltipFooterSpacer: { flex: 1 } },
      },
      tooltipProps: { 'aria-modal': true, role: 'alertdialog' },
    } as unknown as TooltipRenderProps;

    return (
      <div data-testid="joyride">
        {TooltipComponent ? <TooltipComponent {...tooltipProps} /> : null}
      </div>
    );
  },
}));

const hint = (id = 'hint-one', version = 1): ContextualHintDefinition => ({
  id,
  version,
  target: '#target',
  placement: 'auto',
  title: 'Hint title',
  content: 'Hint content',
});

const tour: GuidedTourDefinition = {
  id: 'tour-one',
  steps: [
    { id: 'step-one', target: '#target', content: 'First' },
    { id: 'step-two', target: '#target-two', content: 'Second' },
  ],
};

function Harness() {
  const guidance = useGuidance();
  return (
    <>
      <button type="button" onClick={() => guidance.reachContextualHint('hint-one')}>
        Reach hint
      </button>
      <button type="button" onClick={() => guidance.reachContextualHint('hint-two')}>
        Reach second
      </button>
      <button type="button" onClick={() => guidance.startGuidedTour('tour-one')}>
        Start tour
      </button>
      <div id="target">Target</div>
      <div id="target-two">Second target</div>
    </>
  );
}

function StateMilestoneHarness() {
  useProgressiveContextualHints(['hint-one']);
  return <div id="target">Target</div>;
}

const sequences = { 'data-loader': ['hint-one', 'hint-two'] } as const;

function renderGuidance({
  hints = [hint()],
  tours = [tour],
}: {
  hints?: ContextualHintDefinition[];
  tours?: GuidedTourDefinition[];
} = {}) {
  return render(
    <GuidanceProvider
      contextualHints={hints}
      contextualHintSequences={sequences}
      guidedTours={tours}
    >
      <GuidanceVisitBoundary view="data-loader">
        <Harness />
      </GuidanceVisitBoundary>
    </GuidanceProvider>,
  );
}

describe('GuidanceProvider', () => {
  beforeEach(() => {
    fixture.enabled = true;
    fixture.joyrideProps = null;
    fixture.updatePreferences.mockReset();
    useModalLayerStore.setState({ count: 0 });
    useGuidanceAcknowledgmentsStore.setState({ byUser: {} });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('renders no Joyride UI until a registered milestone is reached', () => {
    renderGuidance({ hints: [], tours: [] });
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
  });

  it('restores state-derived milestone registration after Strict Mode effect replay', async () => {
    render(
      <StrictMode>
        <GuidanceProvider
          contextualHints={[hint()]}
          contextualHintSequences={sequences}
          guidedTours={[]}
        >
          <GuidanceVisitBoundary view="data-loader">
            <StateMilestoneHarness />
          </GuidanceVisitBoundary>
        </GuidanceProvider>
      </StrictMode>,
    );

    expect(await screen.findByTestId('joyride')).toBeInTheDocument();
  });

  it('configures a blocking, dismissible Contextual Hint', async () => {
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));

    expect(screen.getByTestId('joyride')).toBeInTheDocument();
    expect(fixture.joyrideProps?.locale).toEqual({ close: 'Not now', last: 'Got it' });
    expect(fixture.joyrideProps?.options).toMatchObject({
      buttons: ['primary'],
      blockTargetInteraction: true,
      dismissKeyAction: 'close',
      overlayClickAction: false,
      targetWaitTimeout: 3_000,
      width: 360,
    });
    expect(fixture.joyrideProps?.steps[0]?.placement).toBe('auto');
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.getByText('Esc = Not now · Enter = Got it')).toBeInTheDocument();
  });

  it('removes animated scrolling when reduced motion is requested', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));

    expect(fixture.joyrideProps?.options?.scrollDuration).toBe(0);
  });

  it('acknowledges with Enter and advances to another reached milestone', async () => {
    const user = userEvent.setup();
    renderGuidance({ hints: [hint(), hint('hint-two')] });
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    await user.click(screen.getByRole('button', { name: 'Reach second' }));

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toEqual({
      'hint-one': 1,
    });
    await waitFor(() => expect(fixture.joyrideProps?.steps[0]?.id).toBe('hint-two'));
  });

  it('defers the visit without acknowledging when Not now is chosen', async () => {
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toBeUndefined();
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
  });

  it('defers a missing target without acknowledgment', async () => {
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    act(() => {
      fixture.joyrideProps?.onEvent?.(
        { type: EVENTS.TARGET_NOT_FOUND } as Parameters<NonNullable<JoyrideProps['onEvent']>>[0],
        {} as Parameters<NonNullable<JoyrideProps['onEvent']>>[1],
      );
    });

    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toBeUndefined();
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
  });

  it('stores the highest acknowledged version and allows a higher version', async () => {
    const user = userEvent.setup();
    const view = renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toEqual({
      'hint-one': 1,
    });
    view.unmount();
    renderGuidance({ hints: [hint('hint-one', 2)] });
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    expect(screen.getByTestId('joyride')).toBeInTheDocument();
  });

  it('confirms disabling and resumes the same hint when cancellation is chosen', async () => {
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    await user.click(screen.getByRole('button', { name: 'Disable Hints' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'You can turn them back on or reset your hint history at any time in User Settings → Guidance.',
    );
    await user.click(screen.getByRole('button', { name: 'Keep hints on' }));
    expect(await screen.findByTestId('joyride')).toBeInTheDocument();
    expect(fixture.updatePreferences).not.toHaveBeenCalled();
  });

  it('keeps deliberate tours available when Contextual Hints are disabled', async () => {
    fixture.enabled = false;
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start tour' }));
    expect(screen.getByTestId('joyride')).toBeInTheDocument();
    expect(fixture.joyrideProps?.options?.buttons).toEqual(['back', 'skip', 'primary']);
  });

  it('ends an active Contextual Hint without acknowledgment when disabled', async () => {
    const user = userEvent.setup();
    const view = renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    fixture.enabled = false;
    view.rerender(
      <GuidanceProvider
        contextualHints={[hint()]}
        contextualHintSequences={sequences}
        guidedTours={[tour]}
      >
        <GuidanceVisitBoundary view="data-loader">
          <Harness />
        </GuidanceVisitBoundary>
      </GuidanceProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId('joyride')).not.toBeInTheDocument());
    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toBeUndefined();
  });

  it('waits behind an app modal, then resumes the same inert guidance layer', async () => {
    useModalLayerStore.setState({ count: 1 });
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));

    const portal = screen.getByTestId('guidance-portal');
    expect(portal).toHaveAttribute('inert');
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
    act(() => useModalLayerStore.setState({ count: 0 }));
    expect(await screen.findByTestId('joyride')).toBeInTheDocument();
    act(() => useModalLayerStore.setState({ count: 1 }));
    expect(portal).toHaveAttribute('inert');
    expect(fixture.joyrideProps?.options?.disableFocusTrap).toBe(true);
  });

  it('recognizes Escape as a deferral event from Joyride', async () => {
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Reach hint' }));
    act(() => {
      fixture.joyrideProps?.onEvent?.(
        {
          origin: ORIGIN.KEYBOARD,
          status: STATUS.FINISHED,
          type: EVENTS.TOUR_END,
        } as Parameters<NonNullable<JoyrideProps['onEvent']>>[0],
        {} as Parameters<NonNullable<JoyrideProps['onEvent']>>[1],
      );
    });
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toBeUndefined();
  });
});
