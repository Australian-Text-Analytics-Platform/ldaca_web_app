import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  findLanguage,
  languageLabel,
  normaliseIso6391LanguageCode,
  orderedTokenizerModelsForLanguage,
  partitionTokenizerModelsForLanguage,
} from '../languages';

const TOKENIZER_MODELS = [
  { model: 'native:plain_words_en', label: 'Plain words (English)', languages: ['en'] },
  { model: 'huggingface:bert-base-uncased', label: 'BERT base uncased', languages: ['en'] },
  { model: 'lindera:cc-cedict', label: 'CC-CEDICT', languages: ['zh'] },
  { model: 'lindera:jieba', label: 'Jieba', languages: ['zh'] },
  { model: 'lindera:ja-ipadic', label: 'IPADIC', languages: ['ja'] },
  { model: 'lindera:ja-ipadic-neologd', label: 'IPADIC Neologd', languages: ['ja'] },
  { model: 'lindera:ja-unidic', label: 'UniDic', languages: ['ja'] },
  { model: 'lindera:ko-dic', label: 'ko-dic', languages: ['ko'] },
];

describe('SUPPORTED_LANGUAGES', () => {
  it('always includes English as the first option', () => {
    expect(SUPPORTED_LANGUAGES[0]?.code).toBe('en');
    expect(SUPPORTED_LANGUAGES[0]?.quotationSupported).toBe(true);
  });

  it('includes Chinese as a language selector option', () => {
    const zh = SUPPORTED_LANGUAGES.find((l) => l.code === 'zh');
    expect(zh).toBeDefined();
    expect(zh?.quotationSupported).toBe(false);
  });

  it('marks every non-English language as quotation-unsupported', () => {
    const nonEn = SUPPORTED_LANGUAGES.filter((l) => l.code !== 'en');
    expect(nonEn.length).toBeGreaterThan(0);
    expect(nonEn.every((l) => !l.quotationSupported)).toBe(true);
  });

  it('does not embed tokenizer model inventory or defaults', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect('recommendedModel' in lang).toBe(false);
      expect('models' in lang).toBe(false);
    }
  });

  it('uses ISO-style lowercase language codes', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(lang.code).toBe(lang.code.toLowerCase());
      expect(lang.code).toMatch(/^[a-z]{2}$/);
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
  });

  it('falls back to the raw code for unknown languages', () => {
    expect(languageLabel('xx')).toBe('xx');
    expect(languageLabel('multi')).toBe('multi');
  });

  it('defaults to English when nothing is provided', () => {
    expect(languageLabel(null)).toBe('English');
    expect(languageLabel(undefined)).toBe('English');
    expect(languageLabel('')).toBe('English');
  });
});

describe('tokenizer model inventory', () => {
  it('normalises detector outputs to ISO 639-1 language codes', () => {
    expect(normaliseIso6391LanguageCode('EN')).toBe('en');
    expect(normaliseIso6391LanguageCode('zh-Hans')).toBe('zh');
    expect(normaliseIso6391LanguageCode('pt_BR')).toBe('pt');
    expect(normaliseIso6391LanguageCode('multi')).toBeNull();
    expect(normaliseIso6391LanguageCode('')).toBeNull();
  });

  it('orders predefined tokenizer models with language-compatible models first', () => {
    expect(
      orderedTokenizerModelsForLanguage(TOKENIZER_MODELS, 'ja').map((option) => option.model),
    ).toEqual([
      'lindera:ja-ipadic',
      'lindera:ja-ipadic-neologd',
      'lindera:ja-unidic',
      'native:plain_words_en',
      'huggingface:bert-base-uncased',
      'lindera:cc-cedict',
      'lindera:jieba',
      'lindera:ko-dic',
    ]);
  });

  it('partitions recommended models separately so the dropdown can outline them', () => {
    const { recommended, other } = partitionTokenizerModelsForLanguage(TOKENIZER_MODELS, 'en-AU');
    expect(recommended.map((option) => option.model)).toEqual([
      'native:plain_words_en',
      'huggingface:bert-base-uncased',
    ]);
    expect(other).toHaveLength(TOKENIZER_MODELS.length - 2);
  });
});
