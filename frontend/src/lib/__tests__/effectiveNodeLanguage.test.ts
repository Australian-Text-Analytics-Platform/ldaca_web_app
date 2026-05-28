/**
 * Phase 4 frontend mirror of the backend ``effective_language`` resolver
 * — same precedence rules, defensively reads structural fields so it
 * works against both ``WorkspaceNode`` and the looser
 * ``WorkspaceNodeLike`` used by analysis-feature props.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  effectiveNodeLanguage,
  isEnglish,
} from '../effectiveNodeLanguage';

const ZH_META = {
  column_name: 'tokenization.text.lindera:jieba',
  model: 'lindera:jieba',
  language: 'zh',
};

const EN_META = {
  column_name: 'tokenization.text.huggingface:bert-base-uncased',
  model: 'huggingface:bert-base-uncased',
  language: 'en',
};

describe('effectiveNodeLanguage', () => {
  it('returns the explicit override when provided', () => {
    expect(
      effectiveNodeLanguage({
        explicit: 'ja',
        node: { tokenization: { text: ZH_META } },
        defaultLanguage: 'zh',
      }),
    ).toBe('ja');
  });

  it('falls back to tokenization metadata when no explicit override', () => {
    expect(
      effectiveNodeLanguage({
        node: { tokenization: { text: ZH_META } },
      }),
    ).toBe('zh');
  });

  it('falls back to default preference after tokenization', () => {
    expect(
      effectiveNodeLanguage({
        node: { tokenization: {} },
        defaultLanguage: 'zh',
      }),
    ).toBe('zh');
  });

  it('defaults to English when nothing is set', () => {
    expect(effectiveNodeLanguage({})).toBe(DEFAULT_LANGUAGE);
    expect(effectiveNodeLanguage({ node: null, defaultLanguage: null })).toBe(
      DEFAULT_LANGUAGE,
    );
  });

  it('normalises case and whitespace on every input', () => {
    expect(effectiveNodeLanguage({ explicit: ' ZH ' })).toBe('zh');
    expect(effectiveNodeLanguage({ defaultLanguage: 'EN' })).toBe('en');
  });

  it('reads through a node-like object with an index signature', () => {
    // ``WorkspaceNodeLike`` is ``Record<string, unknown>`` — the resolver
    // must accept any shape that *might* carry a ``tokenization`` field.
    const looseNode: Record<string, unknown> = { tokenization: { text: ZH_META } };
    expect(effectiveNodeLanguage({ node: looseNode })).toBe('zh');
  });

  it('returns English when tokenization has only an English column', () => {
    expect(
      effectiveNodeLanguage({ node: { tokenization: { text: EN_META } } }),
    ).toBe('en');
  });

  it('walks every tokenization entry until a non-empty language is found', () => {
    const node = {
      tokenization: {
        a: { ...ZH_META, language: null },
        b: { ...ZH_META, language: '' },
        c: ZH_META,
      },
    };
    expect(effectiveNodeLanguage({ node })).toBe('zh');
  });

  it('is robust against malformed tokenization dicts', () => {
    // Realistically a typed payload won't be malformed, but defensive
    // reads keep the resolver from throwing on unexpected backend changes.
    expect(
      effectiveNodeLanguage({ node: { tokenization: 'not-a-dict' as unknown } }),
    ).toBe(DEFAULT_LANGUAGE);
    expect(
      effectiveNodeLanguage({
        node: { tokenization: { a: 'not-a-meta' as unknown } as unknown },
      }),
    ).toBe(DEFAULT_LANGUAGE);
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
