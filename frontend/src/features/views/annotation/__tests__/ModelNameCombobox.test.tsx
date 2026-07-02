import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelNameCombobox } from '../components/ModelNameCombobox';
import { makeCustomProvider, resolveAnnotationAiProvider } from '../aiProviders';

// The combobox now lists models through our backend (`/annotation/ai/models`),
// so we mock the generated SDK function instead of stubbing global fetch. The
// backend performs the real provider SDK call and returns a sorted id list.
const { listAnnotationAiModels } = vi.hoisted(() => ({
  listAnnotationAiModels: vi.fn(),
}));
vi.mock('@/api', () => ({ listAnnotationAiModels }));

// Resolve a test id to a provider: built-ins from the catalogue, 'custom' stands
// in for a user-defined OpenAI-compatible provider (now backend-listable against
// its base URL), and 'nolisting' is a synthetic provider that opts out of listing
// so the plain-text fallback branch still gets exercised.
function resolveForTest(providerId: string) {
  if (providerId === 'custom') {
    return makeCustomProvider({
      id: 'custom:test',
      name: 'My LLM',
      base_url: 'https://llm.example/v1',
    });
  }
  if (providerId === 'nolisting') {
    return {
      id: 'nolisting:test',
      label: 'No Listing',
      baseUrl: 'https://nolist.example/v1',
      isCustom: true,
      requiresApiKey: false,
      supportsModelListing: false,
    };
  }
  return resolveAnnotationAiProvider(providerId, []);
}

// Return a resolved SDK payload (matching `{ data: { models } }`) for a model id list.
function modelsResult(ids: string[]) {
  return { data: { models: ids }, error: undefined, request: new Request('http://t'), response: new Response() };
}

// Small stateful host so the controlled combobox actually updates as the user
// types or selects, exercising the filter + fill flow end to end.
function Harness({
  providerId,
  apiKey = '',
  onCommit,
}: {
  providerId: string;
  apiKey?: string;
  onCommit?: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <ModelNameCombobox
      provider={resolveForTest(providerId)}
      apiKey={apiKey}
      value={value}
      onChange={setValue}
      onCommit={onCommit}
    />
  );
}

function renderHarness(providerId: string, apiKey = '', onCommit?: (value: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness providerId={providerId} apiKey={apiKey} onCommit={onCommit} />
    </QueryClientProvider>,
  );
}

describe('ModelNameCombobox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom may lack hasPointerCapture despite lib.dom types
    if (!HTMLElement.prototype.hasPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
        configurable: true,
        value: vi.fn(() => false),
      });
    }
  });

  it('renders a plain text input with no dropdown when the provider opts out of listing', async () => {
    const user = userEvent.setup();
    renderHarness('nolisting');

    const input = screen.getByPlaceholderText('Model name');
    await user.click(input);
    await user.type(input, 'my-model');

    expect(input).toHaveValue('my-model');
    // No popover list is rendered for a non-listing provider, and we never hit the backend.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(listAnnotationAiModels).not.toHaveBeenCalled();
  });

  it('opens the backend-backed model list, filters as you type, and fills the field on click', async () => {
    listAnnotationAiModels.mockResolvedValue(
      modelsResult(['anthropic/claude-3-haiku', 'openai/gpt-4o']),
    );

    const user = userEvent.setup();
    renderHarness('openrouter');

    const input = screen.getByRole('textbox');
    await user.click(input);

    // Both listed models appear once the query resolves.
    expect(await screen.findByRole('button', { name: 'openai/gpt-4o' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'anthropic/claude-3-haiku' })).toBeInTheDocument();
    // The backend is asked to list for this provider (base_url null for built-ins).
    expect(listAnnotationAiModels).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { provider_id: 'openrouter', base_url: null, api_key: '' },
        throwOnError: true,
      }),
    );

    // Typing narrows the list to matching ids.
    await user.type(input, 'claude');
    expect(screen.queryByRole('button', { name: 'openai/gpt-4o' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'anthropic/claude-3-haiku' })).toBeInTheDocument();

    // Clicking a row fills the input with that model id.
    await user.click(screen.getByRole('button', { name: 'anthropic/claude-3-haiku' }));
    expect(input).toHaveValue('anthropic/claude-3-haiku');
  });

  it('commits the selected model id when a row is picked', async () => {
    listAnnotationAiModels.mockResolvedValue(modelsResult(['openai/gpt-4o']));
    const onCommit = vi.fn();

    const user = userEvent.setup();
    renderHarness('openrouter', '', onCommit);

    await user.click(screen.getByRole('textbox'));
    await user.click(await screen.findByRole('button', { name: 'openai/gpt-4o' }));

    // Picking a row persists the chosen id (without waiting for a blur).
    expect(onCommit).toHaveBeenCalledWith('openai/gpt-4o');
  });

  it('passes the trimmed api key to the backend for keyed providers', async () => {
    listAnnotationAiModels.mockResolvedValue(modelsResult(['gpt-4o']));

    const user = userEvent.setup();
    renderHarness('openai', '  sk-trim  ');

    await user.click(screen.getByRole('textbox'));
    await screen.findByRole('button', { name: 'gpt-4o' });

    expect(listAnnotationAiModels).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { provider_id: 'openai', base_url: null, api_key: 'sk-trim' },
        throwOnError: true,
      }),
    );
  });

  it('commits a free-typed model id on blur when listing is unsupported', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    renderHarness('nolisting', '', onCommit);

    const input = screen.getByPlaceholderText('Model name');
    await user.click(input);
    await user.type(input, 'local-llama');
    expect(onCommit).not.toHaveBeenCalled();

    await user.tab();
    expect(onCommit).toHaveBeenCalledWith('local-llama');
  });

  it('lists a custom provider against its base URL with an optional key', async () => {
    listAnnotationAiModels.mockResolvedValue(modelsResult(['pcc', 'system']));

    const user = userEvent.setup();
    renderHarness('custom');

    const input = screen.getByRole('textbox');
    await user.click(input);

    // The custom endpoint's models come back through the same backend proxy.
    expect(await screen.findByRole('button', { name: 'pcc' })).toBeInTheDocument();
    expect(listAnnotationAiModels).toHaveBeenCalledWith(
      expect.objectContaining({
        // Custom providers forward their base URL and treat the key as optional.
        body: { provider_id: 'custom:test', base_url: 'https://llm.example/v1', api_key: '' },
        throwOnError: true,
      }),
    );

    // Picking a listed model fills the field, exactly like the built-in path.
    await user.click(screen.getByRole('button', { name: 'system' }));
    expect(input).toHaveValue('system');
  });

  it('renders the full model list without an artificial cap', async () => {
    // 120 ids exceeds the old 50-row cap; every one should be reachable.
    const ids = Array.from({ length: 120 }, (_, i) => `vendor/model-${String(i).padStart(3, '0')}`);
    listAnnotationAiModels.mockResolvedValue(modelsResult(ids));

    const user = userEvent.setup();
    renderHarness('openrouter');

    await user.click(screen.getByRole('textbox'));

    // The first and last entries both render — nothing is sliced off.
    expect(await screen.findByRole('button', { name: 'vendor/model-000' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'vendor/model-119' })).toBeInTheDocument();
    // All 120 rows are present.
    expect(screen.getAllByRole('button', { name: /^vendor\/model-\d{3}$/ })).toHaveLength(120);
  });

  it('surfaces a listing error from the backend', async () => {
    listAnnotationAiModels.mockRejectedValue(new Error('Failed to list OpenRouter models: 500'));

    const user = userEvent.setup();
    renderHarness('openrouter');

    await user.click(screen.getByRole('textbox'));

    expect(await screen.findByText(/Failed to list OpenRouter models/i)).toBeInTheDocument();
  });
});
