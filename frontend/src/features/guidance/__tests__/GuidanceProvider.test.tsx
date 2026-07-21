import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  EVENTS,
  type Props as JoyrideProps,
  STATUS,
  type TooltipRenderProps,
} from 'react-joyride';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGuidanceAcknowledgmentsStore } from '../acknowledgmentsStore';
import { useGuidance } from '../GuidanceContext';
import { GuidanceProvider } from '../GuidanceProvider';
import { useModalLayerStore } from '../modalLayerStore';
import type { ContextualHintDefinition, GuidedTourDefinition } from '../types';

const fixture = vi.hoisted(() => ({
  enabled: true,
  joyrideProps: null as JoyrideProps | null,
  joyrideRenders: 0,
  updatePreferences: vi.fn(),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/features/preferences/useUserPreferences', () => ({
  useUserPreferences: () => ({
    data: { contextual_hints_enabled: fixture.enabled },
  }),
  useUpdateUserPreferences: () => ({
    mutate: fixture.updatePreferences,
  }),
}));

vi.mock('react-joyride', () => {
  return {
    ACTIONS: { SKIP: 'skip' },
    EVENTS: {
      TARGET_NOT_FOUND: 'error:target_not_found',
      TOUR_END: 'tour:end',
    },
    STATUS: {
      FINISHED: 'finished',
      SKIPPED: 'skipped',
    },
    Joyride: (props: JoyrideProps) => {
      fixture.joyrideProps = props;
      fixture.joyrideRenders += 1;
      const TooltipComponent = props.tooltipComponent;
      const tooltipProps = {
        backProps: {},
        closeProps: {},
        continuous: true,
        controls: {},
        index: 0,
        isLastStep: true,
        primaryProps: {
          children: 'Got it',
          onClick: vi.fn(),
        },
        size: 1,
        skipProps: {},
        step: {
          ...props.steps[0],
          buttons: props.options?.buttons ?? ['primary'],
          styles: {
            ...props.styles,
            tooltipFooterSpacer: { flex: 1 },
          },
        },
        tooltipProps: {
          'aria-modal': true,
          role: 'alertdialog',
        },
      } as unknown as TooltipRenderProps;

      return (
        <div data-testid="joyride">
          {TooltipComponent ? <TooltipComponent {...tooltipProps} /> : null}
        </div>
      );
    },
  };
});

const hint = (version = 1): ContextualHintDefinition => ({
  id: 'hint-one',
  version,
  target: '#target',
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
      <button type="button" onClick={() => guidance.requestContextualHint('hint-one')}>
        Request hint
      </button>
      <button type="button" onClick={() => guidance.requestContextualHint('hint-two')}>
        Request second
      </button>
      <button type="button" onClick={() => guidance.startGuidedTour('tour-one')}>
        Start tour
      </button>
      <div id="target">Target</div>
      <div id="target-two">Second target</div>
    </>
  );
}

function renderGuidance({
  hints = [hint()],
  tours = [tour],
}: {
  hints?: ContextualHintDefinition[];
  tours?: GuidedTourDefinition[];
} = {}) {
  return render(
    <GuidanceProvider contextualHints={hints} guidedTours={tours}>
      <Harness />
    </GuidanceProvider>,
  );
}

describe('GuidanceProvider', () => {
  beforeEach(() => {
    fixture.enabled = true;
    fixture.joyrideProps = null;
    fixture.joyrideRenders = 0;
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

  it('renders no Joyride UI for the empty production registries', () => {
    renderGuidance({ hints: [], tours: [] });
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
  });

  it('configures a blocking one-action Contextual Hint', async () => {
    const user = userEvent.setup();
    renderGuidance();

    await user.click(screen.getByRole('button', { name: 'Request hint' }));

    expect(screen.getByTestId('joyride')).toBeInTheDocument();
    expect(fixture.joyrideProps?.locale).toEqual({ last: 'Got it' });
    expect(fixture.joyrideProps?.options).toMatchObject({
      arrowBase: 22,
      arrowSize: 11,
      buttons: ['primary'],
      blockTargetInteraction: true,
      dismissKeyAction: false,
      offset: 14,
      overlayClickAction: false,
      skipBeacon: true,
      spotlightPadding: 6,
      spotlightRadius: 14,
      targetWaitTimeout: 3_000,
      width: 360,
    });
    expect(fixture.joyrideProps?.styles).toMatchObject({
      tooltip: {
        borderRadius: 'calc(var(--radius) + 4px)',
        boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.1)',
      },
      tooltipContainer: {
        textAlign: 'left',
      },
    });
    expect(fixture.joyrideProps?.styles?.spotlight).toBeUndefined();
    expect(screen.getByTestId('guidance-portal')).toHaveClass('fixed', 'inset-0', 'z-[100]');
    expect(screen.getByText('Target')).not.toHaveClass('guidance-target-active');
    expect(screen.getByRole('button', { name: 'Disable Hints' })).toHaveClass('bg-destructive');
  });

  it('forwards per-hint automatic placement to Joyride', async () => {
    const user = userEvent.setup();
    renderGuidance({ hints: [{ ...hint(), placement: 'auto' }] });

    await user.click(screen.getByRole('button', { name: 'Request hint' }));

    expect(fixture.joyrideProps?.steps[0]?.placement).toBe('auto');
  });

  it('uses bottom placement when a Contextual Hint does not override it', async () => {
    const user = userEvent.setup();
    renderGuidance();

    await user.click(screen.getByRole('button', { name: 'Request hint' }));

    expect(fixture.joyrideProps?.steps[0]?.placement).toBe('bottom');
  });

  it('confirms disabling hints and explains how to restore them in settings', async () => {
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Request hint' }));

    await user.click(screen.getByRole('button', { name: 'Disable Hints' }));

    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'You can turn them back on or reset your hint history at any time in User Settings → Guidance.',
    );
    await user.click(screen.getByRole('button', { name: 'Disable Hints' }));

    expect(fixture.updatePreferences).toHaveBeenCalledWith({
      contextual_hints_enabled: false,
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
  });

  it('resumes the same hint when disabling is cancelled', async () => {
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Request hint' }));
    await user.click(screen.getByRole('button', { name: 'Disable Hints' }));

    await user.click(screen.getByRole('button', { name: 'Keep hints on' }));

    expect(await screen.findByTestId('joyride')).toBeInTheDocument();
    expect(fixture.joyrideProps?.steps[0]?.id).toBe('hint-one');
    expect(fixture.updatePreferences).not.toHaveBeenCalled();
  });

  it('stores the highest acknowledged version and allows a higher version', async () => {
    const user = userEvent.setup();
    const view = renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Request hint' }));

    act(() => {
      fixture.joyrideProps?.onEvent?.(
        {
          type: EVENTS.TOUR_END,
          status: STATUS.FINISHED,
        } as Parameters<NonNullable<JoyrideProps['onEvent']>>[0],
        {} as Parameters<NonNullable<JoyrideProps['onEvent']>>[1],
      );
    });

    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toEqual({
      'hint-one': 1,
    });
    expect(screen.getByTestId('guidance-portal')).not.toHaveClass('fixed', 'inset-0');
    await user.click(screen.getByRole('button', { name: 'Request hint' }));
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
    view.unmount();
    fixture.joyrideProps = null;
    renderGuidance({ hints: [hint(2)] });
    await user.click(screen.getByRole('button', { name: 'Request hint' }));
    expect(screen.getByTestId('joyride')).toBeInTheDocument();
  });

  it('does not acknowledge a missing target and admits the next request', async () => {
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Request hint' }));

    act(() => {
      fixture.joyrideProps?.onEvent?.(
        { type: EVENTS.TARGET_NOT_FOUND } as Parameters<NonNullable<JoyrideProps['onEvent']>>[0],
        {} as Parameters<NonNullable<JoyrideProps['onEvent']>>[1],
      );
    });

    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Request hint' }));
    expect(screen.getByTestId('joyride')).toBeInTheDocument();
  });

  it('ignores additional guidance requests while one session is active', async () => {
    const user = userEvent.setup();
    renderGuidance({
      hints: [hint(), { ...hint(), id: 'hint-two', content: 'Second hint' }],
    });
    await user.click(screen.getByRole('button', { name: 'Request hint' }));
    await user.click(screen.getByRole('button', { name: 'Request second' }));

    expect(fixture.joyrideProps?.steps[0]?.id).toBe('hint-one');
  });

  it('keeps deliberate tours available when Contextual Hints are disabled', async () => {
    fixture.enabled = false;
    const user = userEvent.setup();
    renderGuidance();

    await user.click(screen.getByRole('button', { name: 'Request hint' }));
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start tour' }));

    expect(screen.getByTestId('joyride')).toBeInTheDocument();
    expect(fixture.joyrideProps?.options?.buttons).toEqual(['back', 'skip', 'primary']);
    expect(fixture.joyrideProps?.locale).toEqual({ last: 'Done' });
  });

  it('ends an active Contextual Hint without acknowledgment when disabled', async () => {
    const user = userEvent.setup();
    const view = renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Request hint' }));
    expect(screen.getByTestId('joyride')).toBeInTheDocument();

    fixture.enabled = false;
    view.rerender(
      <GuidanceProvider contextualHints={[hint()]} guidedTours={[tour]}>
        <Harness />
      </GuidanceProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId('joyride')).not.toBeInTheDocument());
    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toBeUndefined();
  });

  it('waits behind an app modal, then resumes the same inert guidance layer', async () => {
    useModalLayerStore.setState({ count: 1 });
    const user = userEvent.setup();
    renderGuidance();
    await user.click(screen.getByRole('button', { name: 'Request hint' }));

    const portal = screen.getByTestId('guidance-portal');
    expect(portal).toHaveAttribute('inert');
    expect(portal).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('joyride')).not.toBeInTheDocument();

    act(() => {
      useModalLayerStore.setState({ count: 0 });
    });
    expect(await screen.findByTestId('joyride')).toBeInTheDocument();

    act(() => {
      useModalLayerStore.setState({ count: 1 });
    });
    expect(screen.getByTestId('joyride')).toBeInTheDocument();
    expect(portal).toHaveAttribute('inert');
    expect(fixture.joyrideProps?.options?.disableFocusTrap).toBe(true);
  });
});
