import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AddAnnotationProviderDialog } from '../components/AddAnnotationProviderDialog';

const mocks = vi.hoisted(() => ({
  addAnnotationProvider: vi.fn(),
}));

vi.mock('@/features/provider-credentials/useProviderCredentials', () => ({
  useProviderCredentials: () => ({
    addAnnotationProvider: mocks.addAnnotationProvider,
  }),
}));

describe('AddAnnotationProviderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.addAnnotationProvider.mockResolvedValue({
      id: '74a93227-c081-4db9-af2e-ad357b62278d',
      name: 'OpenRouter',
      provider: 'openrouter',
      base_url: null,
      has_api_key: true,
      credentialRevision: 1,
    });
  });

  it('defaults to OpenRouter and accepts the gray name suggestion with Tab', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<AddAnnotationProviderDialog open onOpenChange={vi.fn()} onCreated={onCreated} />);

    const name = screen.getByLabelText('Name');
    expect(name).toHaveAttribute('placeholder', 'OpenRouter');
    expect(name).toHaveValue('');
    await user.click(name);
    await user.keyboard('{Tab}');
    expect(name).toHaveValue('OpenRouter');
    expect(name).toHaveFocus();

    await user.type(screen.getByLabelText(/API Key/), 'personal-key');
    await user.click(screen.getByRole('button', { name: 'Add Provider' }));

    await waitFor(() =>
      expect(mocks.addAnnotationProvider).toHaveBeenCalledWith({
        name: 'OpenRouter',
        provider: 'openrouter',
        baseUrl: null,
        apiKey: 'personal-key',
      }),
    );
    expect(onCreated).toHaveBeenCalled();
  });

  it('allows a keyless built-in provider and explains that it cannot be used yet', async () => {
    const user = userEvent.setup();
    mocks.addAnnotationProvider.mockResolvedValueOnce({
      id: '74a93227-c081-4db9-af2e-ad357b62278d',
      name: 'OpenRouter',
      provider: 'openrouter',
      base_url: null,
      has_api_key: false,
      credentialRevision: 1,
    });
    render(<AddAnnotationProviderDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText('Name'), 'OpenRouter key later');
    expect(screen.getByText(/an API key is required before use/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Provider' }));

    await waitFor(() =>
      expect(mocks.addAnnotationProvider).toHaveBeenCalledWith({
        name: 'OpenRouter key later',
        provider: 'openrouter',
        baseUrl: null,
        apiKey: '',
      }),
    );
  });

  it('allows a keyless Custom provider and preserves a failed draft', async () => {
    const user = userEvent.setup();
    mocks.addAnnotationProvider.mockRejectedValueOnce(new Error('Could not save provider'));
    render(<AddAnnotationProviderDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: 'Provider' }));
    await user.click(screen.getByRole('option', { name: 'Custom' }));
    await user.type(screen.getByLabelText('Custom Base URL'), 'http://localhost:8080/v1/');
    await user.type(screen.getByLabelText('Name'), 'Local model');
    await user.click(screen.getByRole('button', { name: 'Add Provider' }));

    expect(await screen.findByText('Could not save provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom Base URL')).toHaveValue('http://localhost:8080/v1/');
    expect(screen.getByLabelText('Name')).toHaveValue('Local model');
    expect(mocks.addAnnotationProvider).toHaveBeenCalledWith({
      name: 'Local model',
      provider: 'custom',
      baseUrl: 'http://localhost:8080/v1/',
      apiKey: '',
    });
  });
});
