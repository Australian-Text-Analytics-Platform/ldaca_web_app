import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnnotationAiCustomProvider } from '@/api';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { AiProvidersPreferencesPanel } from '../components/AiProvidersPreferencesPanel';

/** Reset the singleton preferences store so each test starts from empty AI settings. */
function resetStore() {
  usePreferencesStore.setState({
    annotationAiApiKeys: {},
    annotationAiCustomProviders: [],
  });
}

describe('AiProvidersPreferencesPanel', () => {
  beforeEach(() => {
    // Radix Dialog/AlertDialog touch pointer capture, which jsdom may lack.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom may lack hasPointerCapture despite lib.dom types
    if (!HTMLElement.prototype.hasPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
        configurable: true,
        value: vi.fn(() => false),
      });
    }
    resetStore();
  });

  it('lists the built-in providers', () => {
    render(<AiProvidersPreferencesPanel />);
    expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('No custom providers yet.')).toBeInTheDocument();
  });

  it('commits a built-in provider API key to the store on blur', async () => {
    const user = userEvent.setup();
    render(<AiProvidersPreferencesPanel />);

    const input = screen.getByLabelText('OpenAI API key');
    await user.click(input);
    await user.type(input, 'sk-test-123');
    await user.tab();

    expect(usePreferencesStore.getState().annotationAiApiKeys.openai).toBe('sk-test-123');
  });

  it('adds a custom provider through the dialog', async () => {
    const user = userEvent.setup();
    render(<AiProvidersPreferencesPanel />);

    await user.click(screen.getByRole('button', { name: /add provider/i }));
    await user.type(screen.getByLabelText('Name'), 'My LLM');
    await user.type(screen.getByLabelText('Base URL'), 'https://llm.example/v1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const providers = usePreferencesStore.getState().annotationAiCustomProviders;
    expect(providers).toHaveLength(1);
    expect(providers[0]?.name).toBe('My LLM');
    expect(providers[0]?.base_url).toBe('https://llm.example/v1');
    expect(providers[0]?.id).toMatch(/^custom:/);
  });

  it('edits an existing custom provider in place', async () => {
    const existing: AnnotationAiCustomProvider = {
      id: 'custom:1',
      name: 'Old Name',
      base_url: 'https://old.example/v1',
    };
    usePreferencesStore.setState({ annotationAiCustomProviders: [existing] });
    const user = userEvent.setup();
    render(<AiProvidersPreferencesPanel />);

    await user.click(screen.getByRole('button', { name: 'Edit Old Name' }));
    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const providers = usePreferencesStore.getState().annotationAiCustomProviders;
    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe('custom:1');
    expect(providers[0]?.name).toBe('New Name');
  });

  it('deletes a custom provider and its API key after confirmation', async () => {
    usePreferencesStore.setState({
      annotationAiCustomProviders: [
        { id: 'custom:1', name: 'Doomed', base_url: 'https://x.example/v1' },
      ],
      annotationAiApiKeys: { 'custom:1': 'secret' },
    });
    const user = userEvent.setup();
    render(<AiProvidersPreferencesPanel />);

    await user.click(screen.getByRole('button', { name: 'Delete Doomed' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(usePreferencesStore.getState().annotationAiCustomProviders).toHaveLength(0);
    expect(usePreferencesStore.getState().annotationAiApiKeys['custom:1']).toBeUndefined();
  });
});
