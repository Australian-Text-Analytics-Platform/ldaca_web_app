import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdaterWindow } from '../UpdaterWindow';

const mocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  dismissUpdate: vi.fn(),
  downloadUpdate: vi.fn(),
  getUpdaterSnapshot: vi.fn(),
  installUpdate: vi.fn(),
  openUpdateLink: vi.fn(),
}));

vi.mock('../desktopUpdater', () => mocks);

const update = {
  currentVersion: '0.7.5',
  version: '0.8.0',
  publicationDate: '2026-08-28T00:00:00Z',
  notes:
    '## Highlights\n\n- Faster startup\n- [Details](https://example.com/release)\n\n<script>unsafe()</script>\n\n![Remote](https://example.com/image.png)',
};

describe('UpdaterWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dismissUpdate.mockResolvedValue(undefined);
    mocks.installUpdate.mockResolvedValue(undefined);
    mocks.openUpdateLink.mockResolvedValue(undefined);
    mocks.getUpdaterSnapshot.mockResolvedValue({ status: 'available', update });
  });

  it('shows checking and then the up-to-date state for a manual check', async () => {
    let finishCheck: ((value: { status: 'upToDate'; currentVersion: string }) => void) | undefined;
    mocks.checkForUpdates.mockReturnValue(
      new Promise((resolve) => {
        finishCheck = resolve;
      }),
    );
    render(<UpdaterWindow mode="manual" />);

    expect(screen.getByText('Checking for updates…')).toBeInTheDocument();
    finishCheck?.({ status: 'upToDate', currentVersion: '0.7.5' });
    expect(await screen.findByText('Wordflow is up to date')).toBeInTheDocument();
  });

  it('renders GFM notes safely and opens HTTPS links through native IPC', async () => {
    const user = userEvent.setup();
    render(<UpdaterWindow mode="available" />);

    expect(await screen.findByRole('heading', { name: 'Highlights' })).toBeInTheDocument();
    expect(screen.getByText('Faster startup')).toBeInTheDocument();
    expect(screen.queryByText('unsafe()')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Remote' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Details' }));
    expect(mocks.openUpdateLink).toHaveBeenCalledWith('https://example.com/release');
  });

  it('supports skip and later actions for the available update', async () => {
    const user = userEvent.setup();
    const view = render(<UpdaterWindow mode="available" />);
    await screen.findByText('Wordflow 0.8.0');

    await user.click(screen.getByRole('button', { name: 'Skip this version' }));
    expect(mocks.dismissUpdate).toHaveBeenCalledWith('skip');
    view.unmount();

    render(<UpdaterWindow mode="available" />);
    await screen.findByText('Wordflow 0.8.0');
    await user.click(screen.getByRole('button', { name: 'Decide later' }));
    expect(mocks.dismissUpdate).toHaveBeenCalledWith('later');
  });

  it('shows determinate download progress and requires install confirmation', async () => {
    let finishDownload: (() => void) | undefined;
    mocks.downloadUpdate.mockImplementation((onEvent: (event: unknown) => void) => {
      onEvent({ event: 'started', data: { contentLength: 100 } });
      onEvent({ event: 'progress', data: { chunkLength: 40 } });
      return new Promise<void>((resolve) => {
        finishDownload = resolve;
      });
    });
    const user = userEvent.setup();
    render(<UpdaterWindow mode="available" />);
    await screen.findByText('Wordflow 0.8.0');

    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByText('40% complete')).toBeInTheDocument();
    finishDownload?.();
    expect(await screen.findByRole('button', { name: 'Restart and install' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restart and install' }));
    expect(mocks.installUpdate).toHaveBeenCalledOnce();
    expect(screen.getByText('Installing update…')).toBeInTheDocument();
  });

  it('uses indeterminate progress without a length and retries recoverable download errors', async () => {
    let failDownload: ((reason: Error) => void) | undefined;
    mocks.downloadUpdate
      .mockImplementationOnce((onEvent: (event: unknown) => void) => {
        onEvent({ event: 'started', data: { contentLength: null } });
        return new Promise<void>((_resolve, reject) => {
          failDownload = reject;
        });
      })
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<UpdaterWindow mode="available" />);
    await screen.findByText('Wordflow 0.8.0');

    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByText('Preparing and verifying the update…')).toBeInTheDocument();
    failDownload?.(new Error('network unavailable'));
    expect(await screen.findByText('network unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(mocks.downloadUpdate).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Restart and install' })).toBeInTheDocument();
  });
});
