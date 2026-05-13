import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadMergedStopwords } from '../loadMergedStopwords';

const { defaultStopWordsMock } = vi.hoisted(() => ({
  defaultStopWordsMock: vi.fn(),
}));

vi.mock('@/api/text', () => ({
  textApi: {
    defaultStopWords: defaultStopWordsMock,
  },
}));

const getAuthHeaders = () => ({ Authorization: 'Bearer test' });

describe('loadMergedStopwords', () => {
  beforeEach(() => {
    defaultStopWordsMock.mockReset();
  });

  it('returns an empty result when no languages are supplied', async () => {
    const result = await loadMergedStopwords({
      languages: [],
      getAuthHeaders,
    });
    expect(result).toEqual({ byLanguage: [], merged: [] });
    expect(defaultStopWordsMock).not.toHaveBeenCalled();
  });

  it('deduplicates language codes and fetches each unique language once', async () => {
    defaultStopWordsMock.mockResolvedValue({ stopwords: ['the', 'and'] });
    await loadMergedStopwords({
      languages: ['en', 'EN ', ' en', null, undefined, 'en'],
      getAuthHeaders,
    });
    expect(defaultStopWordsMock).toHaveBeenCalledTimes(1);
    expect(defaultStopWordsMock).toHaveBeenCalledWith(
      { Authorization: 'Bearer test' },
      { language: 'en' },
    );
  });

  it('produces per-language groups and a deduplicated flat merge', async () => {
    defaultStopWordsMock.mockImplementation(
      (_headers: unknown, options?: { language?: string }) => {
        if (options?.language === 'en') {
          return Promise.resolve({ stopwords: ['the', 'and', 'shared'] });
        }
        if (options?.language === 'zh') {
          return Promise.resolve({ stopwords: ['的', 'shared', '了'] });
        }
        return Promise.resolve({ stopwords: [] });
      },
    );

    const result = await loadMergedStopwords({
      languages: ['en', 'zh'],
      getAuthHeaders,
    });

    expect(result.byLanguage).toEqual([
      { language: 'en', words: ['the', 'and', 'shared'] },
      { language: 'zh', words: ['的', 'shared', '了'] },
    ]);
    // ``shared`` appears in both lists but only once in the flat merge,
    // preserving the first-occurrence order across groups.
    expect(result.merged).toEqual(['the', 'and', 'shared', '的', '了']);
  });

  it('tolerates a backend payload with a legacy ``data`` field', async () => {
    defaultStopWordsMock.mockResolvedValue({ data: ['foo', 'bar'] });
    const result = await loadMergedStopwords({
      languages: ['xx'],
      getAuthHeaders,
    });
    expect(result.byLanguage[0]).toEqual({
      language: 'xx',
      words: ['foo', 'bar'],
    });
  });
});
