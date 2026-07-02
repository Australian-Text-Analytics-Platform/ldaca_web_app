import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomProviderDialog } from '../components/CustomProviderDialog';
import type { AnnotationAiCustomProvider } from '@/api';

// Stateful host so the controlled dialog can open and the close-on-save flow runs.
function Harness({ onSave }: { onSave: (p: AnnotationAiCustomProvider) => void }) {
  const [open, setOpen] = useState(true);
  return <CustomProviderDialog open={open} onOpenChange={setOpen} onSave={onSave} />;
}

// Edit-mode host: passes an existing provider so the dialog prefills + reuses its id.
function EditHarness({
  onSave,
  provider,
}: {
  onSave: (p: AnnotationAiCustomProvider) => void;
  provider: AnnotationAiCustomProvider;
}) {
  const [open, setOpen] = useState(true);
  return (
    <CustomProviderDialog open={open} onOpenChange={setOpen} onSave={onSave} provider={provider} />
  );
}

describe('CustomProviderDialog', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom may lack hasPointerCapture despite lib.dom types
    if (!HTMLElement.prototype.hasPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
        configurable: true,
        value: vi.fn(() => false),
      });
    }
  });

  it('disables Save until both name and base URL are provided', async () => {
    const user = userEvent.setup();
    render(<Harness onSave={vi.fn()} />);

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('Name'), 'My LLM');
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('Base URL'), 'https://llm.example/v1');
    expect(save).toBeEnabled();
  });

  it('emits a custom:<id> provider on save and closes', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSave={onSave} />);

    await user.type(screen.getByLabelText('Name'), '  My LLM  ');
    await user.type(screen.getByLabelText('Base URL'), '  https://llm.example/v1  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as AnnotationAiCustomProvider;
    expect(saved.id).toMatch(/^custom:/);
    // Values are trimmed before saving.
    expect(saved.name).toBe('My LLM');
    expect(saved.base_url).toBe('https://llm.example/v1');

    // Dialog closes after a successful save.
    expect(screen.queryByText('Add custom provider')).not.toBeInTheDocument();
  });

  it('prefills fields in edit mode and keeps the provider id on save', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    const provider: AnnotationAiCustomProvider = {
      id: 'custom:abc',
      name: 'My LLM',
      base_url: 'https://llm.example/v1',
    };
    render(<EditHarness onSave={onSave} provider={provider} />);

    // Edit mode shows its own title and pre-populates both inputs.
    expect(screen.getByText('Edit custom provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('My LLM');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://llm.example/v1');

    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed LLM');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as AnnotationAiCustomProvider;
    // The id is preserved so the store replaces the provider in place.
    expect(saved.id).toBe('custom:abc');
    expect(saved.name).toBe('Renamed LLM');
    expect(saved.base_url).toBe('https://llm.example/v1');
  });
});
