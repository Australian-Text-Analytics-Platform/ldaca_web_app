import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HintOverlay } from '../HintOverlay';
import type { HintDefinition } from '../types';

const hint: HintDefinition = {
  id: 'workspace',
  title: 'Workspace',
  body: 'Create a workspace.',
  condition: 'no-active-workspace',
  anchorHintId: 'workspace-target',
};

describe('HintOverlay measurement ownership', () => {
  let activeObservers = 0;
  let activeScrollListeners = 0;
  let activeResizeListeners = 0;

  beforeEach(() => {
    document.body.replaceChildren();
    activeObservers = 0;
    activeScrollListeners = 0;
    activeResizeListeners = 0;

    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(_callback: ResizeObserverCallback) {
          activeObservers += 1;
        }

        observe() {
          return undefined;
        }

        disconnect() {
          activeObservers -= 1;
        }
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const addEventListener = window.addEventListener.bind(window);
    const removeEventListener = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'scroll') activeScrollListeners += 1;
      if (type === 'resize') activeResizeListeners += 1;
      addEventListener(type, listener, options);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
      if (type === 'scroll') activeScrollListeners -= 1;
      if (type === 'resize') activeResizeListeners -= 1;
      removeEventListener(type, listener, options);
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shares one listener and observer owner across the ring and bubble', async () => {
    const firstTarget = document.createElement('button');
    vi.spyOn(firstTarget, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 20, y: 20, width: 100, height: 40 }),
    );
    const secondTarget = document.createElement('button');
    vi.spyOn(secondTarget, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 40, y: 40, width: 120, height: 40 }),
    );
    document.body.append(firstTarget, secondTarget);

    const onDismissSession = vi.fn();
    const props = {
      hint,
      target: firstTarget,
      measurementRevision: 0,
      onDismissPermanent: vi.fn(),
      onDismissSession,
    };
    const view = render(<HintOverlay {...props} />);

    expect(activeObservers).toBe(1);
    expect(activeScrollListeners).toBe(1);
    expect(activeResizeListeners).toBe(1);
    expect(screen.getByTestId('hint-highlight-ring')).toBeInTheDocument();

    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Got it' }).focus();
    await user.keyboard('{Enter}');
    expect(onDismissSession).toHaveBeenCalledTimes(1);

    view.rerender(<HintOverlay {...props} measurementRevision={1} />);
    expect(activeObservers).toBe(1);
    expect(activeScrollListeners).toBe(1);
    expect(activeResizeListeners).toBe(1);

    view.rerender(<HintOverlay {...props} target={secondTarget} measurementRevision={2} />);
    expect(activeObservers).toBe(1);
    expect(activeScrollListeners).toBe(1);
    expect(activeResizeListeners).toBe(1);

    act(() => {
      view.unmount();
    });
    expect(activeObservers).toBe(0);
    expect(activeScrollListeners).toBe(0);
    expect(activeResizeListeners).toBe(0);
  });
});
