/**
 * Phase 4.2: the supported-languages list is shared by AddFilePanel,
 * Tokenise (Phase 4.3), and any future UI selector. Locks the codes +
 * recommended models so a UI choice round-trips end-to-end against the
 * backend ``effective_language`` resolver and ``recommended_tokenizer_for``.
 */
import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  findLanguage,
  languageLabel,
} from '../languages';

describe('SUPPORTED_LANGUAGES', () => {
  it('always includes English as the first option', () => {
    expect(SUPPORTED_LANGUAGES[0]?.code).toBe('en');
    expect(SUPPORTED_LANGUAGES[0]?.quotationSupported).toBe(true);
  });

  it('includes Chinese with the jieba recommended tokenizer', () => {
    const zh = SUPPORTED_LANGUAGES.find((l) => l.code === 'zh');
    expect(zh).toBeDefined();
    expect(zh?.recommendedModel).toBe('jieba');
    expect(zh?.quotationSupported).toBe(false);
  });

  it('marks every non-English language as quotation-unsupported', () => {
    // Decision 4 / Phase 3.6: quotation extractor is English-only.
    const nonEn = SUPPORTED_LANGUAGES.filter((l) => l.code !== 'en');
    expect(nonEn.length).toBeGreaterThan(0);
    expect(nonEn.every((l) => !l.quotationSupported)).toBe(true);
  });

  it('points Japanese + Korean at Lindera defaults (Phase 5)', () => {
    expect(findLanguage('ja')?.recommendedModel).toBe('lindera-ja-ipadic');
    expect(findLanguage('ko')?.recommendedModel).toBe('lindera-ko-dic');
  });

  it('exposes JA dict choices so the Tokenise dialog can render a picker', () => {
    const ja = findLanguage('ja');
    expect(ja?.availableDicts?.length).toBeGreaterThan(1);
    // First entry must match the recommended model so the dialog opens
    // with the default preselected.
    expect(ja?.availableDicts?.[0]?.model).toBe(ja?.recommendedModel);
  });

  it('keeps Korean as a single-dict language (only ko-dic)', () => {
    // KO has no UniDic-style alternate; the dict selector should hide
    // itself, not render a one-option dropdown.
    const ko = findLanguage('ko');
    expect(ko?.availableDicts).toBeUndefined();
  });

  it('surfaces a first-use download hint for Lindera languages', () => {
    expect(findLanguage('ja')?.firstUseHint).toBeTruthy();
    expect(findLanguage('ko')?.firstUseHint).toBeTruthy();
    // Non-Lindera languages don't carry the hint — Jieba dict is bundled
    // in the wheel and HF tokenizers are tiny.
    expect(findLanguage('en')?.firstUseHint).toBeUndefined();
    expect(findLanguage('zh')?.firstUseHint).toBeUndefined();
  });

  it('uses ISO-style lowercase language codes', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(lang.code).toBe(lang.code.toLowerCase());
      // Codes should be 2 letters or "multi" (curated bucket for the
      // multilingual fallback path).
      expect(lang.code === 'multi' || lang.code.length === 2).toBe(true);
    }
  });
});

describe('findLanguage', () => {
  it('matches case-insensitively with whitespace trimmed', () => {
    expect(findLanguage(' EN ')?.code).toBe('en');
    expect(findLanguage('Zh')?.code).toBe('zh');
  });

  it('returns null for unknown codes', () => {
    expect(findLanguage('xx')).toBeNull();
    expect(findLanguage('')).toBeNull();
    expect(findLanguage(null)).toBeNull();
    expect(findLanguage(undefined)).toBeNull();
  });
});

describe('languageLabel', () => {
  it('returns the curated label for known codes', () => {
    expect(languageLabel('en')).toBe('English');
    expect(languageLabel('zh')).toBe('Chinese');
    expect(languageLabel('ja')).toBe('Japanese');
    expect(languageLabel('ko')).toBe('Korean');
    expect(languageLabel('multi')).toBe('Other / Multilingual');
  });

  it('falls back to the raw code for unknown languages', () => {
    expect(languageLabel('xx')).toBe('xx');
  });

  it('defaults to English when nothing is provided', () => {
    expect(languageLabel(null)).toBe('English');
    expect(languageLabel(undefined)).toBe('English');
    expect(languageLabel('')).toBe('English');
  });
});
