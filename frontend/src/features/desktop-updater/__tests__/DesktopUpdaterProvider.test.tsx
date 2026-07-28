import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopUpdaterProvider } from '../DesktopUpdaterProvider';
import { DesktopUpdateSettingsPanel } from '../DesktopUpdateSettingsPanel';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  checkDesktopUpdate: vi.fn(),
  getDesktopVersion: vi.fn(),
  relaunchDesktopApp: vi.fn(),
}));

vi.mock('@/lib/isTauri', () => ({
  isTauri: mocks.isTauri,
}));

vi.mock('../desktopUpdaterRuntime', () => ({
  checkDesktopUpdate: mocks.checkDesktopUpdate,
  getDesktopVersion: mocks.getDesktopVersion,
  relaunchDesktopApp: mocks.relaunchDesktopApp,
}));

describe('DesktopUpdaterProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(true);
    mocks.getDesktopVersion.mockResolvedValue('0.7.0');
    mocks.relaunchDesktopApp.mockResolvedValue(undefined);
  });

  it('prompts for a signed update and relaunches after installation', async () => {
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

    render(
      <DesktopUpdaterProvider>
        <DesktopUpdateSettingsPanel />
      </DesktopUpdaterProvider>,
    );

    expect(
      await screen.findByRole('alertdialog', { name: 'LDaCA Wordflow 0.8.0 is available' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Release notes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download and restart' }));

    await waitFor(() => {
      expect(downloadAndInstall).toHaveBeenCalledOnce();
      expect(mocks.relaunchDesktopApp).toHaveBeenCalledOnce();
    });
  });

  it('supports a manual check and reports an up-to-date installation', async () => {
    const user = userEvent.setup();
    mocks.checkDesktopUpdate.mockResolvedValue(null);

    render(
      <DesktopUpdaterProvider>
        <DesktopUpdateSettingsPanel />
      </DesktopUpdaterProvider>,
    );

    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText('0.7.0')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(mocks.checkDesktopUpdate).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Up to date')).toBeInTheDocument();
  });

  it('reopens an available update without creating another native resource', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    mocks.checkDesktopUpdate.mockResolvedValue({
      version: '0.8.0',
      body: null,
      downloadAndInstall: vi.fn(),
      close,
    });

    const view = render(
      <DesktopUpdaterProvider>
        <DesktopUpdateSettingsPanel />
      </DesktopUpdaterProvider>,
    );

    await screen.findByRole('alertdialog', { name: 'LDaCA Wordflow 0.8.0 is available' });
    await user.click(screen.getByRole('button', { name: 'Later' }));
    await user.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(mocks.checkDesktopUpdate).toHaveBeenCalledOnce();
    view.unmount();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not invoke Tauri APIs in the web runtime', () => {
    mocks.isTauri.mockReturnValue(false);

    render(
      <DesktopUpdaterProvider>
        <p>Web application</p>
      </DesktopUpdaterProvider>,
    );

    expect(screen.getByText('Web application')).toBeInTheDocument();
    expect(mocks.checkDesktopUpdate).not.toHaveBeenCalled();
    expect(mocks.getDesktopVersion).not.toHaveBeenCalled();
  });
});
