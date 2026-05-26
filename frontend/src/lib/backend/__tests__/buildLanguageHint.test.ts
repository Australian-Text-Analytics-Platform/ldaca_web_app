/**
 * Phase 4.4: ``buildLanguageHint`` picks the language code an analysis
 * request should carry. Explicit override wins; the per-user
 * ``defaultLanguage`` preference fills in when the call site doesn't pass
 * one. ``undefined`` flows back to the backend's resolution chain.
 */
import { describe, expect, it } from 'vitest';
import { buildLanguageHint } from '../text';

describe('buildLanguageHint', () => {
  it.each([
    ['zh', 'en', 'zh'],
    [undefined, 'zh', 'zh'],
    ['', 'zh', 'zh'],
    [null, 'zh', 'zh'],
    [undefined, undefined, undefined],
    [' en ', undefined, 'en'],
    [undefined, ' zh ', 'zh'],
    ['EN', undefined, 'EN'],
  ])('resolves override=%s default=%s to %s', (override, defaultLanguage, expected) => {
    expect(buildLanguageHint(override, defaultLanguage)).toBe(expected);
  });
});
