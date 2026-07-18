import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS, STATUS, type Props as JoyrideProps } from 'react-joyride';

import { GuidanceProvider } from '../GuidanceProvider';
import { useGuidance } from '../GuidanceContext';
import { useGuidanceAcknowledgmentsStore } from '../acknowledgmentsStore';
import { useModalLayerStore } from '../modalLayerStore';
import type { ContextualHintDefinition, GuidedTourDefinition } from '../types';

const fixture = vi.hoisted(() => ({
  enabled: true,
  joyrideProps: null as JoyrideProps | null,
  joyrideRenders: 0,
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/features/preferences/useUserPreferences', () => ({
  useUserPreferences: () => ({
    data: { contextual_hints_enabled: fixture.enabled },
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
      return <div data-testid="joyride" />;
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
      buttons: ['primary'],
      blockTargetInteraction: true,
      dismissKeyAction: false,
      overlayClickAction: false,
      skipBeacon: true,
      targetWaitTimeout: 3_000,
    });
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
