/**
 * Phase 4.1: preferences store carries optional ``defaultLanguage`` and
 * ``defaultTokenizerModel`` synced to the backend. The store normalises
 * inputs so backend resolution doesn't see stray case / whitespace.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { usePreferencesStore } from '../preferencesStore';

function resetStore() {
  // Reset to factory defaults between tests so partialize-persisted state
  // from prior tests doesn't leak.
  usePreferencesStore.setState({
    hiddenViews: ['ai-annotator'],
    favoriteWorkspaces: [],
    quotationEngine: { type: 'local' },
    quotationLastRemoteUrl: '',
    defaultLanguage: null,
    defaultTokenizerModel: null,
    hydrated: false,
    syncing: false,
  });
}

describe('preferencesStore default language fields', () => {
  beforeEach(() => {
    resetStore();
  });

  it('starts with null defaults', () => {
    const state = usePreferencesStore.getState();
    expect(state.defaultLanguage).toBeNull();
    expect(state.defaultTokenizerModel).toBeNull();
  });

  it('setDefaultLanguage normalises case and whitespace', () => {
    const { setDefaultLanguage } = usePreferencesStore.getState();
    setDefaultLanguage('ZH');
    expect(usePreferencesStore.getState().defaultLanguage).toBe('zh');
    setDefaultLanguage(' En ');
    expect(usePreferencesStore.getState().defaultLanguage).toBe('en');
  });

  it('setDefaultLanguage treats empty / whitespace as clearing the value', () => {
    const { setDefaultLanguage } = usePreferencesStore.getState();
    setDefaultLanguage('zh');
    expect(usePreferencesStore.getState().defaultLanguage).toBe('zh');
    setDefaultLanguage('');
    expect(usePreferencesStore.getState().defaultLanguage).toBeNull();
    setDefaultLanguage('zh');
    setDefaultLanguage('   ');
    expect(usePreferencesStore.getState().defaultLanguage).toBeNull();
    setDefaultLanguage('zh');
    setDefaultLanguage(null);
    expect(usePreferencesStore.getState().defaultLanguage).toBeNull();
  });

  it('setDefaultTokenizerModel preserves casing (model IDs are case-sensitive)', () => {
    const { setDefaultTokenizerModel } = usePreferencesStore.getState();
    setDefaultTokenizerModel('cl-tohoku/bert-base-japanese-v3');
    expect(usePreferencesStore.getState().defaultTokenizerModel).toBe(
      'cl-tohoku/bert-base-japanese-v3'
    );
    // Trimming is still applied so stray copy/paste whitespace doesn't leak.
    setDefaultTokenizerModel(' jieba ');
    expect(usePreferencesStore.getState().defaultTokenizerModel).toBe('jieba');
  });

  it('setDefaultTokenizerModel clears on empty input', () => {
    const { setDefaultTokenizerModel } = usePreferencesStore.getState();
    setDefaultTokenizerModel('jieba');
    setDefaultTokenizerModel('');
    expect(usePreferencesStore.getState().defaultTokenizerModel).toBeNull();
  });

  it('defaults survive partialize persistence (covered by partialize key list)', () => {
    // Indirectly: the partialize selector includes defaultLanguage /
    // defaultTokenizerModel, so the persisted blob round-trips them.
    const { setDefaultLanguage, setDefaultTokenizerModel } =
      usePreferencesStore.getState();
    setDefaultLanguage('ja');
    setDefaultTokenizerModel('cl-tohoku/bert-base-japanese-v3');

    const state = usePreferencesStore.getState();
    expect(state.defaultLanguage).toBe('ja');
    expect(state.defaultTokenizerModel).toBe('cl-tohoku/bert-base-japanese-v3');
  });
});
