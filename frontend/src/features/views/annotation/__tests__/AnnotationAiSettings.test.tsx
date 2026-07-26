import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AnnotationProviderConfigurationView } from '@/features/provider-credentials/providerCredentialsStore';
import { AnnotationAiSettings } from '../components/AnnotationAiSettings';

vi.mock('../components/AddAnnotationProviderDialog', () => ({
  AddAnnotationProviderDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Add provider form</div> : null,
}));

const configurations: AnnotationProviderConfigurationView[] = [
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
];

const renderSettings = (onProviderChange = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AnnotationAiSettings
        configurations={configurations}
        selectedConfigurationId={configurations[0]!.id}
        onProviderChange={onProviderChange}
        onModelChange={vi.fn()}
        onModelCommit={vi.fn()}
        providerModels={{ [configurations[1]!.id]: 'model-2' }}
        model=""
      />
    </QueryClientProvider>,
  );
  return onProviderChange;
};

describe('AnnotationAiSettings', () => {
  it('renders configured instances only and keeps Add Provider at the bottom', async () => {
    const user = userEvent.setup();
    renderSettings();
    expect(screen.getByText('OpenRouter personal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Provider' }));
    const rows = screen.getAllByRole('button');
    expect(screen.getByText('OpenRouter org')).toBeInTheDocument();
    expect(rows.at(-1)).toHaveTextContent('Add Provider');
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument();
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument();
  });

  it('selects each provider instance independently and opens Add Provider', async () => {
    const user = userEvent.setup();
    const onProviderChange = vi.fn();
    renderSettings(onProviderChange);
    await user.click(screen.getByRole('button', { name: 'Provider' }));
    await user.click(screen.getByRole('button', { name: /OpenRouter org/ }));
    expect(onProviderChange).toHaveBeenCalledWith(configurations[1], 'model-2');

    await user.click(screen.getByRole('button', { name: 'Provider' }));
    await user.click(screen.getByRole('button', { name: 'Add Provider' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Add provider form');
  });
});
