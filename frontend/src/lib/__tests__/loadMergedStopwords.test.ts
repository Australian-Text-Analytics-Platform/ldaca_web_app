import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadMergedStopwords } from '../loadMergedStopwords';

const { getDefaultStopWordsMock } = vi.hoisted(() => ({
  getDefaultStopWordsMock: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  getDefaultStopWords: getDefaultStopWordsMock,
}));

const getAuthHeaders = () => ({ Authorization: 'Bearer test' });

describe('loadMergedStopwords', () => {
  beforeEach(() => {
    getDefaultStopWordsMock.mockReset();
  });

  it('returns an empty result when no languages are supplied', async () => {
    const result = await loadMergedStopwords({
      languages: [],
      getAuthHeaders,
    });
    expect(result).toEqual({ byLanguage: [], merged: [] });
    expect(getDefaultStopWordsMock).not.toHaveBeenCalled();
  });

  it('deduplicates language codes and fetches each unique language once', async () => {
    getDefaultStopWordsMock.mockResolvedValue({ data: { stopwords: ['the', 'and'] }, error: undefined });
    await loadMergedStopwords({
      languages: ['en', 'EN ', ' en', null, undefined, 'en'],
      getAuthHeaders,
    });
    expect(getDefaultStopWordsMock).toHaveBeenCalledTimes(1);
    expect(getDefaultStopWordsMock).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer test' },
      query: { language: 'en', strict: true },
      throwOnError: true,
    });
  });

  it('produces per-language groups and a deduplicated flat merge', async () => {
    getDefaultStopWordsMock.mockImplementation(
      (options?: { query?: { language?: string; strict?: boolean } }) => {
        if (options?.query?.language === 'en') {
          return Promise.resolve({ data: { stopwords: ['the', 'and', 'shared'] }, error: undefined });
        }
        if (options?.query?.language === 'zh') {
          return Promise.resolve({ data: { stopwords: ['的', 'shared', '了'] }, error: undefined });
        }
        return Promise.resolve({ data: { stopwords: [] }, error: undefined });
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

});
