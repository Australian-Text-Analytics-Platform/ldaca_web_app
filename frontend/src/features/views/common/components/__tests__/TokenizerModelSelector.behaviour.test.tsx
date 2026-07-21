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
 * Renders TokenizerModelSelector with a fresh query client so lazy model loading
 * and language detection cache state cannot leak between behavior tests.
 */
const renderSelector = ({
  value = '',
  onChange = vi.fn(),
}: {
  value?: string;
  onChange?: Mock;
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
          onChange={onChange}
        />
      </QueryClientProvider>,
    ),
  };
};

describe('TokenizerModelSelector', () => {
  beforeEach(() => {
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

  it('fetches models on open and outlines language-compatible recommendations', async () => {
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
  });

  it('offers None as a clearing option', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelector({ value: 'native:plain_words_en' });

    await user.click(screen.getByRole('combobox', { name: /tokenizer model/i }));
    await user.click(await screen.findByText('None'));

    expect(onChange).toHaveBeenCalledWith('', 'en');
  });
});
