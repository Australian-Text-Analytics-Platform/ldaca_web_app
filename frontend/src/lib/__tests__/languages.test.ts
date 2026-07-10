import { describe, expect, it } from 'vitest';
import { normaliseIso6391LanguageCode, partitionTokenizerModelsForLanguage } from '../languages';

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

describe('tokenizer model inventory', () => {
  it('normalises detector outputs to ISO 639-1 language codes', () => {
    expect(normaliseIso6391LanguageCode('EN')).toBe('en');
    expect(normaliseIso6391LanguageCode('zh-Hans')).toBe('zh');
    expect(normaliseIso6391LanguageCode('pt_BR')).toBe('pt');
    expect(normaliseIso6391LanguageCode('multi')).toBeNull();
    expect(normaliseIso6391LanguageCode('')).toBeNull();
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
