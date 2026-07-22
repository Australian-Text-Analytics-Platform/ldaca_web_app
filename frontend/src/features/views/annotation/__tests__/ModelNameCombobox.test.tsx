import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelNameCombobox } from '../components/ModelNameCombobox';
import type { AnnotationProviderConfigurationView } from '@/features/provider-credentials/providerCredentialsStore';

const listAnnotationModelsWithProviderCredential = vi.hoisted(() => vi.fn());
vi.mock('@/features/provider-credentials/providerCredentialRequests', () => ({
  listAnnotationModelsWithProviderCredential,
}));

const configuration: AnnotationProviderConfigurationView = {
  id: '74a93227-c081-4db9-af2e-ad357b62278d',
  name: 'OpenRouter personal',
  provider: 'openrouter',
  base_url: null,
  has_api_key: true,
  credentialRevision: 3,
};
const renderCombobox = (
  value = '',
  selectedConfiguration: AnnotationProviderConfigurationView = configuration,
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ModelNameCombobox
        workspaceId="workspace-1"
        configuration={selectedConfiguration}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
      />
    </QueryClientProvider>,
  );
  return { onChange, onCommit };
};

describe('ModelNameCombobox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAnnotationModelsWithProviderCredential.mockResolvedValue({
      data: { models: ['openrouter/alpha', 'openrouter/beta'] },
    });
  });

  it('loads the generated provider model catalogue when opened', async () => {
    renderCombobox();
    const input = screen.getByPlaceholderText('Search or type a model name');
    fireEvent.focus(input);
    await waitFor(() => expect(listAnnotationModelsWithProviderCredential).toHaveBeenCalled());
    expect(listAnnotationModelsWithProviderCredential.mock.calls[0]?.[0]).toEqual(configuration);
    expect(await screen.findByRole('button', { name: 'openrouter/alpha' })).toBeInTheDocument();
  });

  it('commits a selected model without persisting a credential in the browser', async () => {
    const { onChange, onCommit } = renderCombobox();
    fireEvent.focus(screen.getByPlaceholderText('Search or type a model name'));
    const option = await screen.findByRole('button', { name: 'openrouter/beta' });
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('openrouter/beta');
    expect(onCommit).toHaveBeenCalledWith('openrouter/beta');
  });

  it('keeps manual model entry available when Custom discovery fails', async () => {
    listAnnotationModelsWithProviderCredential.mockRejectedValueOnce(new Error('offline'));
    const customConfiguration: AnnotationProviderConfigurationView = {
      id: '6d7e8079-4382-4434-a9ac-bec4b3ba20fd',
      name: 'Local model',
      provider: 'custom',
      base_url: 'http://localhost:8080/v1',
      has_api_key: false,
      credentialRevision: 1,
    };
    const { onChange } = renderCombobox('', customConfiguration);
    const input = screen.getByPlaceholderText('Search or type a model name');
    fireEvent.focus(input);
    expect(await screen.findByText('Could not list models; type a model name')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'local-model' } });
    expect(onChange).toHaveBeenCalledWith('local-model');
  });
});
