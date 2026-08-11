import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { TopicModelingStopWordsControl } from '../TopicModelingStopWordsControl';

const mocks = vi.hoisted(() => ({
  detectLanguage: vi.fn(),
  loadStopWords: vi.fn(),
}));

vi.mock('@/features/views/common/hooks/useDetectedColumnLanguage', () => ({
  useDetectedColumnLanguage: (args: unknown) => mocks.detectLanguage(args),
}));

vi.mock('@/lib/loadMergedStopwords', () => ({
  listSupportedStopwordLanguages: () => [
    { iso6391: 'af', name: 'Afrikaans' },
    { iso6391: 'en', name: 'English' },
    { iso6391: 'fr', name: 'French' },
  ],
  loadMergedStopwords: (args: unknown) => mocks.loadStopWords(args),
}));

interface HarnessProps {
  initialEnabled?: boolean;
  initialWords?: string[];
  onSave?: (words: string[]) => Promise<void>;
}

function Harness({ initialEnabled = false, initialWords = [], onSave }: HarnessProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [savedWords, setSavedWords] = useState(initialWords);
  return (
    <TooltipProvider>
      <TopicModelingStopWordsControl
        enabled={enabled}
        onEnabledChange={setEnabled}
        savedWords={savedWords}
        workspaceId="workspace-1"
        nodeId="node-1"
        column="text"
        onSavedWordsChange={async (words) => {
          await onSave?.(words);
          setSavedWords(words);
        }}
      />
    </TooltipProvider>
  );
}

describe('TopicModelingStopWordsControl', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.detectLanguage.mockReset();
    mocks.detectLanguage.mockReturnValue({ detectedLanguage: 'en', isDetecting: false });
    mocks.loadStopWords.mockReset();
    mocks.loadStopWords.mockResolvedValue({ merged: ['the', 'and', 'of'] });
  });

  it('keeps saved controls available while filtering is off and orders action rows first', async () => {
    const user = userEvent.setup();
    render(<Harness initialWords={['the', 'and']} />);

    expect(screen.getByRole('switch', { name: 'Filter stop words' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Stop words language' })).toHaveTextContent(
      'Saved list (2 words)',
    );
    expect(screen.getByRole('combobox', { name: 'Stop words language' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit stop words' })).toBeEnabled();

    await user.click(screen.getByRole('combobox', { name: 'Stop words language' }));

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Clear stop words',
      'Saved list (2 words)',
      'English (Recommended)',
      'Afrikaans',
      'French',
    ]);
    expect(mocks.detectLanguage).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, nodeId: 'node-1', column: 'text' }),
    );
  });

  it('treats a language as a replacement action and leaves the filter switch unchanged', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSave={onSave} />);

    expect(mocks.detectLanguage).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    await user.click(screen.getByRole('combobox', { name: 'Stop words language' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Select language',
      'English (Recommended)',
      'Afrikaans',
      'French',
    ]);
    await user.click(screen.getByRole('option', { name: 'English (Recommended)' }));

    expect(mocks.loadStopWords).toHaveBeenCalledWith({ languages: ['en'] });
    expect(onSave).toHaveBeenCalledWith(['the', 'and', 'of']);
    expect(screen.getByRole('combobox', { name: 'Stop words language' })).toHaveTextContent(
      'Saved list (3 words)',
    );
    expect(screen.getByRole('switch', { name: 'Filter stop words' })).not.toBeChecked();
  });

  it('treats an empty custom save as clearing the saved list', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Harness initialWords={['the']} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit stop words' }));
    await user.clear(screen.getByLabelText('Stop words'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith([]);
    expect(screen.getByRole('combobox', { name: 'Stop words language' })).toHaveTextContent(
      'Select language',
    );
  });

  it('clears only the saved list while an enabled filter remains enabled', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Harness initialEnabled initialWords={['the']} onSave={onSave} />);

    await user.click(screen.getByRole('combobox', { name: 'Stop words language' }));
    await user.click(screen.getByRole('option', { name: 'Clear stop words' }));

    expect(onSave).toHaveBeenCalledWith([]);
    expect(screen.getByRole('combobox', { name: 'Stop words language' })).toHaveTextContent(
      'Select language',
    );
    expect(screen.getByRole('switch', { name: 'Filter stop words' })).toBeChecked();
  });

  it('normalizes a custom draft and closes only after persistence succeeds', async () => {
    const user = userEvent.setup();
    let resolveSave: (() => void) | undefined;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<Harness initialWords={['the']} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit stop words' }));
    const editor = screen.getByLabelText('Stop words');
    expect(editor).toHaveValue('the');
    fireEvent.change(editor, { target: { value: ' About, THE\nabout, and ' } });
    expect(screen.getByText('3 normalized words')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(['about', 'the', 'and']);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    resolveSave?.();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the custom draft open after a failed save and supports cancellation', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('save failed'));
    render(<Harness onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit stop words' }));
    fireEvent.change(screen.getByLabelText('Stop words'), {
      target: { value: 'Custom, custom, list' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Stop words')).toHaveValue('Custom, custom, list');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
