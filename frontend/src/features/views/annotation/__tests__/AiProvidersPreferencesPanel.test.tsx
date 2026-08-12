import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateAnnotationProvider: vi.fn(),
  deleteAnnotationProvider: vi.fn(),
  clearAnnotationProviders: vi.fn(),
  retry: vi.fn(),
  isLoading: false,
  error: null as Error | null,
}));

vi.mock('@/features/provider-credentials/useProviderCredentials', () => ({
  useProviderCredentials: () => ({
    storage: 'browser',
    isLoading: mocks.isLoading,
    error: mocks.error,
    annotationProviders: [
      {
        id: '74a93227-c081-4db9-af2e-ad357b62278d',
        name: 'OpenRouter personal',
        provider: 'openrouter',
        base_url: null,
        has_api_key: true,
        credentialRevision: 1,
      },
      {
        id: '8a342ceb-1ed6-433a-bc3f-75b6fd5dba38',
        name: 'OpenRouter org',
        provider: 'openrouter',
        base_url: null,
        has_api_key: true,
        credentialRevision: 1,
      },
    ],
    updateAnnotationProvider: mocks.updateAnnotationProvider,
    deleteAnnotationProvider: mocks.deleteAnnotationProvider,
    clearAnnotationProviders: mocks.clearAnnotationProviders,
    retry: mocks.retry,
  }),
}));

vi.mock('../components/AddAnnotationProviderDialog', () => ({
  AddAnnotationProviderDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Add provider form</div> : null,
}));

import { AiProvidersPreferencesPanel } from '../components/AiProvidersPreferencesPanel';

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AiProvidersPreferencesPanel />
    </QueryClientProvider>,
  );

describe('AiProvidersPreferencesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAnnotationProvider.mockResolvedValue(undefined);
    mocks.deleteAnnotationProvider.mockResolvedValue(undefined);
    mocks.clearAnnotationProviders.mockResolvedValue(undefined);
    mocks.retry.mockResolvedValue(undefined);
    mocks.isLoading = false;
    mocks.error = null;
  });

  it('shows ordered named configurations and opens the shared Add dialog', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByText('OpenRouter personal')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter org')).toBeInTheDocument();
    expect(screen.getAllByText('Key saved')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Add Provider' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Add provider form');
  });

  it('edits name and credential, then confirms deletion through the collection facade', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const input = screen.getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Personal router');
    await user.type(screen.getByLabelText('New API Key'), 'replacement-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.updateAnnotationProvider).toHaveBeenCalledWith(
        '74a93227-c081-4db9-af2e-ad357b62278d',
        { name: 'Personal router', apiKey: 'replacement-key' },
      ),
    );

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mocks.deleteAnnotationProvider).toHaveBeenCalledWith(
        '74a93227-c081-4db9-af2e-ad357b62278d',
      ),
    );
  });

  it('shows backend loading and retryable failure states instead of an empty list', async () => {
    mocks.isLoading = true;
    const view = renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent('Loading Annotation providers');
    expect(screen.queryByText('No Annotation providers configured.')).not.toBeInTheDocument();
    view.unmount();

    mocks.isLoading = false;
    mocks.error = new Error('offline');
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load Annotation providers');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retry).toHaveBeenCalled();
  });
});
