import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { listTokenizerModels, queryWorkspaceSqlTable } from '@/api';
import { detectLanguageIso6391 } from '@/lib/languageDetection';
import TokenizerModelSelector from '../TokenizerModelSelector';

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable: vi.fn(),
  listTokenizerModels: vi.fn(),
}));

vi.mock('@/lib/languageDetection', () => ({
  detectLanguageIso6391: vi.fn(),
}));

/**
 * Renders TokenizerModelSelector with a fresh query client so model loading
 * and language detection cache state cannot leak between behavior tests.
 */
const renderSelector = ({
  value = '',
  onChange = vi.fn(),
  autoSelectRecommended = false,
}: {
  value?: string;
  onChange?: Mock;
  autoSelectRecommended?: boolean;
} = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    onChange,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TokenizerModelSelector
          workspaceId="workspace-1"
          nodeId="node-1"
          column="text"
          value={value}
          autoSelectRecommended={autoSelectRecommended}
          onChange={onChange}
        />
      </QueryClientProvider>,
    ),
  };
};

describe('TokenizerModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!HTMLElement.prototype.hasPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
        configurable: true,
        value: vi.fn(() => false),
      });
    }

    if (!HTMLElement.prototype.scrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: vi.fn(),
      });
    }
    vi.mocked(queryWorkspaceSqlTable).mockResolvedValue({
      columns: ['text'],
      rows: [
        { text: 'This is a short English document.' },
        { text: 'Another English paragraph for detection.' },
      ],
      hasNext: false,
      etag: '"workspace-1"',
    } as never);
    vi.mocked(listTokenizerModels).mockResolvedValue({
      data: [
        { id: 'native:plain_words_en', label: 'Plain words (English)', languages: ['en'] },
        { id: 'huggingface:bert-base-uncased', label: 'BERT base uncased', languages: ['en'] },
        { id: 'lindera:ja-ipadic', label: 'IPADIC', languages: ['ja'] },
      ],
    } as never);
    vi.mocked(detectLanguageIso6391).mockResolvedValue('en');
  });

  it('automatically selects the first recommended tokenizer for an unset data block', async () => {
    const { onChange } = renderSelector({ autoSelectRecommended: true });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('native:plain_words_en', 'en');
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('loads models for defaulting and outlines language-compatible recommendations on open', async () => {
    const user = userEvent.setup();
    renderSelector();

    expect(listTokenizerModels).not.toHaveBeenCalled();

    await user.click(screen.getByRole('combobox', { name: /tokenizer model/i }));

    await waitFor(() => {
      expect(listTokenizerModels).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText('Recommended')).toBeInTheDocument();
    expect(screen.getByTestId('tokenizer-model-recommendations')).toHaveClass('rounded-lg');
    expect(screen.getByText('Plain words (English)')).toBeInTheDocument();
    expect(screen.getByText('BERT base uncased')).toBeInTheDocument();
    expect(screen.getByText('IPADIC')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /BERT base uncased/ })).toHaveClass(
      '!h-auto',
      'min-h-control-sm',
    );
    expect(screen.getByRole('option', { name: /IPADIC/ })).toHaveClass(
      '!h-auto',
      'min-h-control-sm',
    );
  });

  it('offers None as a clearing option', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelector({
      value: 'native:plain_words_en',
      autoSelectRecommended: true,
    });

    await user.click(screen.getByRole('combobox', { name: /tokenizer model/i }));
    await user.click(await screen.findByText('None'));

    expect(onChange).toHaveBeenCalledWith('', 'en');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
