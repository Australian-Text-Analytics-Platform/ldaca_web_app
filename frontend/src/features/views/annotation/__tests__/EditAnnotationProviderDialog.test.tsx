import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AnnotationProviderConfigurationView } from '@/features/provider-credentials/providerCredentialsStore';
import { EditAnnotationProviderDialog } from '../components/EditAnnotationProviderDialog';

const configuration: AnnotationProviderConfigurationView = {
  id: '74a93227-c081-4db9-af2e-ad357b62278d',
  name: 'Local model',
  provider: 'custom',
  base_url: 'http://localhost:8080/v1',
  has_api_key: true,
  credentialRevision: 3,
};

describe('EditAnnotationProviderDialog', () => {
  it('shows the immutable locator and disables Save until a mutable field changes', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditAnnotationProviderDialog
        configuration={configuration}
        pending={false}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText(configuration.base_url!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Local work');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(configuration.id, { name: 'Local work' });
  });

  it('replaces or explicitly removes a write-only saved key', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <EditAnnotationProviderDialog
        configuration={configuration}
        pending={false}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByLabelText('New API Key'), 'replacement-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith(configuration.id, { apiKey: 'replacement-key' });

    onSave.mockClear();
    rerender(
      <EditAnnotationProviderDialog
        configuration={{ ...configuration, id: '8a342ceb-1ed6-433a-bc3f-75b6fd5dba38' }}
        pending={false}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove saved key' }));
    expect(screen.getByLabelText('New API Key')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith('8a342ceb-1ed6-433a-bc3f-75b6fd5dba38', {
      apiKey: null,
    });
  });
});
