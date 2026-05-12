/**
 * Phase 4.4: ``buildLanguageHint`` picks the language code an analysis
 * request should carry. Explicit override wins; the per-user
 * ``defaultLanguage`` preference fills in when the call site doesn't pass
 * one. ``undefined`` flows back to the backend's resolution chain.
 */
import { describe, expect, it } from 'vitest';
import { buildLanguageHint } from '../text';

describe('buildLanguageHint', () => {
  it('returns the explicit override when set', () => {
    expect(buildLanguageHint('zh', 'en')).toBe('zh');
  });

  it('falls back to the default when override is undefined', () => {
    expect(buildLanguageHint(undefined, 'zh')).toBe('zh');
  });

  it('falls back to the default when override is empty', () => {
    expect(buildLanguageHint('', 'zh')).toBe('zh');
    expect(buildLanguageHint('   ', 'zh')).toBe('zh');
    expect(buildLanguageHint(null, 'zh')).toBe('zh');
  });

  it('returns undefined when neither override nor default is set', () => {
    expect(buildLanguageHint(undefined, undefined)).toBeUndefined();
    expect(buildLanguageHint(null, null)).toBeUndefined();
    expect(buildLanguageHint('', '')).toBeUndefined();
  });

  it('trims surrounding whitespace from both override and default', () => {
    expect(buildLanguageHint(' en ', undefined)).toBe('en');
    expect(buildLanguageHint(undefined, ' zh ')).toBe('zh');
  });

  it('does NOT normalise case (callers control casing — store normalises stored values)', () => {
    // The store's setDefaultLanguage already lowercases; this helper just
    // forwards what it gets to keep concerns separated.
    expect(buildLanguageHint('EN', undefined)).toBe('EN');
  });
});
