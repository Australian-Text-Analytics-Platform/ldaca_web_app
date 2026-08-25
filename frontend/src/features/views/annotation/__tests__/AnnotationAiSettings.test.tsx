import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AnnotationProviderConfigurationView } from '@/features/provider-credentials/providerCredentialsStore';
import { AnnotationAiSettings } from '../components/AnnotationAiSettings';

vi.mock('../components/AddAnnotationProviderDialog', () => ({
  AddAnnotationProviderDialog: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated: (configuration: AnnotationProviderConfigurationView) => void;
  }) =>
    open ? (
      <div role="dialog">
        Add provider form
        <button
          type="button"
          onClick={() =>
            onCreated({
              id: 'keyless-provider',
              name: 'Key later',
              provider: 'openrouter',
              base_url: null,
              has_api_key: false,
              credentialRevision: 1,
            })
          }
        >
          Finish keyless provider
        </button>
      </div>
    ) : null,
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

const renderSettings = (
  onProviderChange = vi.fn(),
  advanced?: ReactNode,
  onAdvancedOpenChange?: (open: boolean) => void,
) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AnnotationAiSettings
        configurations={configurations}
        selectedConfigurationId={configurations[0]!.id}
        onProviderChange={onProviderChange}
        onModelChange={vi.fn()}
        onModelCommit={vi.fn()}
        providerModels={{ [configurations[1]!.id]: 'model-2' }}
        model="model-1"
        advanced={advanced}
        onAdvancedOpenChange={onAdvancedOpenChange}
      />
    </QueryClientProvider>,
  );
  return onProviderChange;
};

describe('AnnotationAiSettings', () => {
  it('renders configured instances only and keeps Add Provider at the bottom', async () => {
    const user = userEvent.setup();
    renderSettings();
    const advancedSummary = screen.getByRole('button', { name: 'Advanced settings' });
    expect(within(advancedSummary).getByText('OpenRouter personal')).toHaveClass('font-medium');
    expect(within(advancedSummary).getByText('OpenRouter')).toHaveClass(
      'text-label-secondary',
      'text-description',
    );

    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
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
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    await user.click(screen.getByRole('button', { name: 'Provider' }));
    await user.click(screen.getByRole('button', { name: /OpenRouter org/ }));
    expect(onProviderChange).toHaveBeenCalledWith(configurations[1], 'model-2');

    await user.click(screen.getByRole('button', { name: 'Provider' }));
    await user.click(screen.getByRole('button', { name: 'Add Provider' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Add provider form');
  });

  it('summarizes provider and model on one line while Advanced is collapsed', async () => {
    const user = userEvent.setup();
    renderSettings(vi.fn(), <div>Example, prompt, and inference settings</div>);

    const advancedSummary = screen.getByRole('button', { name: 'Advanced settings' });
    expect(within(advancedSummary).getByText('OpenRouter personal')).toHaveClass('font-medium');
    expect(within(advancedSummary).getByText('OpenRouter')).toHaveClass(
      'text-label-secondary',
      'text-description',
    );
    expect(screen.getByText('model-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Provider' })).not.toBeInTheDocument();
    await user.click(advancedSummary);

    const expandedTrigger = screen.getByRole('button', { name: 'Advanced settings' });
    expect(expandedTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(expandedTrigger).queryByText('OpenRouter personal')).not.toBeInTheDocument();
    expect(screen.getByText('Example, prompt, and inference settings')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-ai-provider-model-controls')).toHaveClass('grid-cols-2');
  });

  it('returns to the compact summary from the expanded collapse control', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));

    expect(screen.getByRole('button', { name: 'Advanced settings' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('button', { name: 'Provider' })).not.toBeInTheDocument();
  });

  it('reports only actual Advanced expansion state changes', async () => {
    const user = userEvent.setup();
    const onAdvancedOpenChange = vi.fn();
    renderSettings(vi.fn(), undefined, onAdvancedOpenChange);

    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    expect(onAdvancedOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    expect(onAdvancedOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('retains an incomplete selected provider but disables using it', async () => {
    const user = userEvent.setup();
    const incomplete = { ...configurations[0]!, has_api_key: false };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AnnotationAiSettings
          configurations={[incomplete, configurations[1]!]}
          selectedConfigurationId={incomplete.id}
          onProviderChange={vi.fn()}
          onModelChange={vi.fn()}
          onModelCommit={vi.fn()}
          providerModels={{}}
          model=""
        />
      </QueryClientProvider>,
    );

    expect(screen.getAllByText('Needs API key')).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    expect(screen.getByText(/Settings → AI/)).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Provider' }));
    expect(screen.getByRole('button', { name: /OpenRouter personal/ })).toBeDisabled();
  });

  it('saves but does not auto-select a newly added keyless built-in', async () => {
    const user = userEvent.setup();
    const onProviderChange = vi.fn();
    renderSettings(onProviderChange);

    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    await user.click(screen.getByRole('button', { name: 'Provider' }));
    await user.click(screen.getByRole('button', { name: 'Add Provider' }));
    await user.click(screen.getByRole('button', { name: 'Finish keyless provider' }));

    expect(onProviderChange).not.toHaveBeenCalled();
  });
});
