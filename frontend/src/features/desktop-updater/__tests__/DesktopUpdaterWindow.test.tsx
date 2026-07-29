import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopUpdaterWindow } from '../DesktopUpdaterWindow';

const mocks = vi.hoisted(() => ({
  checkDesktopUpdate: vi.fn(),
  hideDesktopUpdaterWindow: vi.fn(),
  listenForDesktopUpdateCheck: vi.fn(),
  relaunchDesktopApp: vi.fn(),
  showDesktopUpdaterWindow: vi.fn(),
}));

let requestUpdateCheck: (() => void) | undefined;

vi.mock('../desktopUpdaterRuntime', () => ({
  checkDesktopUpdate: mocks.checkDesktopUpdate,
  hideDesktopUpdaterWindow: mocks.hideDesktopUpdaterWindow,
  listenForDesktopUpdateCheck: mocks.listenForDesktopUpdateCheck,
  relaunchDesktopApp: mocks.relaunchDesktopApp,
  showDesktopUpdaterWindow: mocks.showDesktopUpdaterWindow,
}));

describe('DesktopUpdaterWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestUpdateCheck = undefined;
    mocks.hideDesktopUpdaterWindow.mockResolvedValue(undefined);
    mocks.showDesktopUpdaterWindow.mockResolvedValue(undefined);
    mocks.listenForDesktopUpdateCheck.mockImplementation(async (listener: () => void) => {
      requestUpdateCheck = listener;
      return vi.fn();
    });
    mocks.relaunchDesktopApp.mockResolvedValue(undefined);
  });

  it('stays hidden when the startup check finds no update', async () => {
    mocks.checkDesktopUpdate.mockResolvedValue(null);

    render(<DesktopUpdaterWindow />);

    expect(await screen.findByText('LDaCA Wordflow is up to date')).toBeInTheDocument();
    expect(mocks.showDesktopUpdaterWindow).not.toHaveBeenCalled();
  });

  it('shows the native window when startup finds an update, then installs it', async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 100 } });
      onEvent({ event: 'Finished' });
    });
    mocks.checkDesktopUpdate.mockResolvedValue({
      version: '0.8.0',
      body: 'Release notes',
      downloadAndInstall,
      close: vi.fn(),
    });

    render(<DesktopUpdaterWindow />);

    expect(await screen.findByText('LDaCA Wordflow 0.8.0 is available')).toBeInTheDocument();
    expect(mocks.showDesktopUpdaterWindow).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Download and restart' }));

    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalledOnce();
      expect(mocks.relaunchDesktopApp).toHaveBeenCalledOnce();
    });
  });

  it('shows manual current and error results in the native window', async () => {
    mocks.checkDesktopUpdate
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('offline'));

    render(<DesktopUpdaterWindow />);

    await screen.findByText('LDaCA Wordflow is up to date');
    await waitFor(() => expect(requestUpdateCheck).toBeTypeOf('function'));
    act(() => requestUpdateCheck?.());

    expect(await screen.findByText('Could not check for updates')).toBeInTheDocument();
    expect(screen.getByText('offline')).toBeInTheDocument();
    expect(mocks.showDesktopUpdaterWindow).toHaveBeenCalledOnce();
  });

  it('hides an available update and reopens the same native resource from the menu', async () => {
    const user = userEvent.setup();
    mocks.checkDesktopUpdate.mockResolvedValue({
      version: '0.8.0',
      body: null,
      downloadAndInstall: vi.fn(),
      close: vi.fn(),
    });

    render(<DesktopUpdaterWindow />);

    await screen.findByText('LDaCA Wordflow 0.8.0 is available');
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(mocks.hideDesktopUpdaterWindow).toHaveBeenCalledOnce();
    act(() => requestUpdateCheck?.());

    await waitFor(() => expect(mocks.showDesktopUpdaterWindow).toHaveBeenCalledTimes(2));
    expect(mocks.checkDesktopUpdate).toHaveBeenCalledOnce();
  });
});
