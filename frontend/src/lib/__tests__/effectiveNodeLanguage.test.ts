/**
 * Frontend language resolver for per-tool UI defaults.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  effectiveNodeLanguage,
  isEnglish,
} from '../effectiveNodeLanguage';

describe('effectiveNodeLanguage', () => {
  it('returns the explicit override when provided', () => {
    expect(
      effectiveNodeLanguage({
        explicit: 'ja',
        defaultLanguage: 'zh',
      }),
    ).toBe('ja');
  });

  it('falls back to default preference after explicit override', () => {
    expect(
      effectiveNodeLanguage({
        defaultLanguage: 'zh',
      }),
    ).toBe('zh');
  });

  it('defaults to English when nothing is set', () => {
    expect(effectiveNodeLanguage({})).toBe(DEFAULT_LANGUAGE);
    expect(effectiveNodeLanguage({ defaultLanguage: null })).toBe(DEFAULT_LANGUAGE);
  });

  it('normalises case and whitespace on every input', () => {
    expect(effectiveNodeLanguage({ explicit: ' ZH ' })).toBe('zh');
    expect(effectiveNodeLanguage({ defaultLanguage: 'EN' })).toBe('en');
  });
});

describe('isEnglish', () => {
  it('returns true for the default English code in any case', () => {
    expect(isEnglish('en')).toBe(true);
    expect(isEnglish(' EN ')).toBe(true);
  });

  it('returns false for any other language', () => {
    expect(isEnglish('zh')).toBe(false);
    expect(isEnglish('multi')).toBe(false);
    expect(isEnglish('')).toBe(false);
  });
});
