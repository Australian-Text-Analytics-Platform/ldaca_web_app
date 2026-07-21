import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelNameCombobox } from '../components/ModelNameCombobox';
import { ANNOTATION_AI_PROVIDERS } from '../aiProviders';

const listAnnotationModelsWithProviderCredential = vi.hoisted(() => vi.fn());
vi.mock('@/features/provider-credentials/providerCredentialRequests', () => ({
  listAnnotationModelsWithProviderCredential,
}));

const provider = ANNOTATION_AI_PROVIDERS[0];
const renderCombobox = (value = '') => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ModelNameCombobox
        workspaceId="workspace-1"
        provider={provider}
        credentialConfigured
        credentialRevision={0}
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
    expect(listAnnotationModelsWithProviderCredential.mock.calls[0]?.[0]).toBe('openrouter');
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
});
