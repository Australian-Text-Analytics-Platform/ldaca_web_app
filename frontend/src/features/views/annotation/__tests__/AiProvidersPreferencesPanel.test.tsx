import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  renameAnnotationProvider: vi.fn(),
  deleteAnnotationProvider: vi.fn(),
  clearAnnotationProviders: vi.fn(),
}));

vi.mock('@/features/provider-credentials/useProviderCredentials', () => ({
  useProviderCredentials: () => ({
    storage: 'browser',
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
    renameAnnotationProvider: mocks.renameAnnotationProvider,
    deleteAnnotationProvider: mocks.deleteAnnotationProvider,
    clearAnnotationProviders: mocks.clearAnnotationProviders,
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
    mocks.renameAnnotationProvider.mockResolvedValue(undefined);
    mocks.deleteAnnotationProvider.mockResolvedValue(undefined);
    mocks.clearAnnotationProviders.mockResolvedValue(undefined);
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

  it('renames and confirms deletion through the collection facade', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getAllByRole('button', { name: 'Rename' })[0]!);
    const input = screen.getByLabelText('Rename OpenRouter personal');
    await user.clear(input);
    await user.type(input, 'Personal router');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.renameAnnotationProvider).toHaveBeenCalledWith(
        '74a93227-c081-4db9-af2e-ad357b62278d',
        'Personal router',
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
});
