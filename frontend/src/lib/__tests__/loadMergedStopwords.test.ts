import { describe, expect, it } from 'vitest';
import { loadMergedStopwords } from '../loadMergedStopwords';

describe('loadMergedStopwords', () => {
  it('returns an empty result when no languages are supplied', async () => {
    const result = await loadMergedStopwords({ languages: [] });

    expect(result).toEqual({ byLanguage: [], merged: [] });
  });

  it('deduplicates normalised language codes before resolving stopwords', async () => {
    const result = await loadMergedStopwords({
      languages: ['en', 'EN ', ' en-AU', null, undefined, 'en'],
    });

    expect(result.byLanguage).toHaveLength(1);
    expect(result.byLanguage[0]?.language).toBe('en');
    expect(result.byLanguage[0]?.words).toContain('about');
    expect(result.merged).toContain('about');
  });

  it('produces per-language groups and a deduplicated flat merge', async () => {
    const result = await loadMergedStopwords({ languages: ['en', 'zh'] });

    expect(result.byLanguage.map((group) => group.language)).toEqual(['en', 'zh']);
    expect(result.merged.indexOf('about')).toBeGreaterThanOrEqual(0);
    expect(result.merged.indexOf('的')).toBeGreaterThan(result.merged.indexOf('about'));
  });

  it('ignores unsupported language codes', async () => {
    const result = await loadMergedStopwords({ languages: ['xx'] });

    expect(result).toEqual({ byLanguage: [], merged: [] });
  });
});
