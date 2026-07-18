import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  updateProviderCredentials: vi.fn(),
  clearProviderCredentials: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getProviderCredentials: mocks.getProviderCredentials,
  updateProviderCredentials: mocks.updateProviderCredentials,
  clearProviderCredentials: mocks.clearProviderCredentials,
}));

import { AiProvidersPreferencesPanel } from '../components/AiProvidersPreferencesPanel';

const renderPanel = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AiProvidersPreferencesPanel />
    </QueryClientProvider>,
  );
};

describe('AiProvidersPreferencesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderCredentials.mockResolvedValue({
      data: {
        annotation: { openai: false, openrouter: true, anthropic: false, google: false },
        data_portal: { deployment_configured: false, user_configured: false },
      },
    });
    mocks.updateProviderCredentials.mockResolvedValue({ data: undefined });
    mocks.clearProviderCredentials.mockResolvedValue({ data: undefined });
  });

  it('shows write-only provider presence state from the backend', async () => {
    renderPanel();
    expect(await screen.findByText('AI provider credentials')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    expect(await screen.findByText('Configured')).toBeInTheDocument();
    expect(screen.getAllByText('Not configured')).toHaveLength(3);
  });

  it('sends a new credential to the canonical provider endpoint without storing it locally', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = await screen.findByLabelText('OpenAI API key');
    await user.type(input, 'sk-test');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[1]!);
    expect(mocks.updateProviderCredentials).toHaveBeenCalledWith({
      body: { openai_api_key: 'sk-test' },
      throwOnError: true,
    });
  });
});
