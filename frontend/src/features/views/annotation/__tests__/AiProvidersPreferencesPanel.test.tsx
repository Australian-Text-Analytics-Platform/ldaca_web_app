import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveAnnotationCredential: vi.fn(),
  clearAnnotationCredential: vi.fn(),
  clearAnnotationCredentials: vi.fn(),
}));

vi.mock('@/features/provider-credentials/useProviderCredentials', () => ({
  useProviderCredentials: () => ({
    storage: 'browser',
    annotation: { openai: false, openrouter: true, anthropic: false, google: false },
    dataPortal: { userConfigured: false, deploymentConfigured: false },
    revision: 1,
    isLoading: false,
    error: null,
    saveAnnotationCredential: mocks.saveAnnotationCredential,
    clearAnnotationCredential: mocks.clearAnnotationCredential,
    clearAnnotationCredentials: mocks.clearAnnotationCredentials,
  }),
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
    mocks.saveAnnotationCredential.mockResolvedValue(undefined);
    mocks.clearAnnotationCredential.mockResolvedValue(undefined);
    mocks.clearAnnotationCredentials.mockResolvedValue(undefined);
  });

  it('shows only credential presence and keeps every input blank', () => {
    renderPanel();
    expect(screen.getByText('AI provider credentials')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getAllByText('Not configured')).toHaveLength(3);
    const inputs = screen.getAllByLabelText(/API key$/);
    expect(inputs).toHaveLength(4);
    for (const input of inputs) expect(input).toHaveValue('');
  });

  it('passes replacements and explicit clears through the credential facade', async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByLabelText('OpenAI API key');
    await user.type(input, 'sk-test');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[1]!);
    expect(mocks.saveAnnotationCredential).toHaveBeenCalledWith('openai', 'sk-test');
    expect(input).toHaveValue('');

    await user.click(screen.getAllByRole('button', { name: 'Clear' })[0]!);
    expect(mocks.clearAnnotationCredential).toHaveBeenCalledWith('openrouter');
  });
});
