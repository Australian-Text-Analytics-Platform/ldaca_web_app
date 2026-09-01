import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveDataPortalCredential: vi.fn(),
  clearDataPortalCredential: vi.fn(),
  configured: false,
}));

vi.mock('../useProviderCredentials', () => ({
  useProviderCredentials: () => ({
    storage: 'browser',
    dataPortal: {
      userConfigured: mocks.configured,
      deploymentConfigured: false,
    },
    saveDataPortalCredential: mocks.saveDataPortalCredential,
    clearDataPortalCredential: mocks.clearDataPortalCredential,
  }),
}));

import { DataPortalCredentialPanel } from '../components/DataPortalCredentialPanel';

describe('DataPortalCredentialPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured = false;
    mocks.saveDataPortalCredential.mockResolvedValue(undefined);
    mocks.clearDataPortalCredential.mockResolvedValue(undefined);
  });

  it('owns Data Portal credential writes without rendering LLM provider setup', async () => {
    const user = userEvent.setup();
    render(<DataPortalCredentialPanel />);

    expect(screen.queryByRole('button', { name: 'Add Provider' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('LDaCA Data Portal token'), 'portal-token');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mocks.saveDataPortalCredential).toHaveBeenCalledWith('portal-token'),
    );
    expect(screen.getByLabelText('LDaCA Data Portal token')).toHaveValue('');
  });

  it('clears an explicitly configured Data Portal token', async () => {
    mocks.configured = true;
    const user = userEvent.setup();
    render(<DataPortalCredentialPanel />);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(mocks.clearDataPortalCredential).toHaveBeenCalledOnce());
  });
});
