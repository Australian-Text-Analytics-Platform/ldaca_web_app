import { describe, expect, it } from 'vitest';

import {
  durablePreferencesEqual,
  encodePreferencesUpdate,
  normalizeServerPreferences,
  projectDurablePreferences,
} from '../preferencesCodec';

describe('preferencesCodec', () => {
  const durable = {
    hiddenViews: ['quotation'],
    favoriteWorkspaces: ['workspace-1'],
    defaultTokenizerModel: 'model-a',
    ldacaOniApiToken: 'oni-token',
    analysisMultiTabEnabled: true,
    annotationAiApiKeys: { openai: 'key' },
    annotationAiCustomProviders: [
      { id: 'custom:1', name: 'Local', base_url: 'http://localhost:9000' },
    ],
  };

  it('normalizes missing server fields into the complete durable frontend shape', () => {
    expect(normalizeServerPreferences({})).toEqual({
      hiddenViews: [],
      favoriteWorkspaces: [],
      defaultTokenizerModel: null,
      ldacaOniApiToken: null,
      analysisMultiTabEnabled: false,
      annotationAiApiKeys: {},
      annotationAiCustomProviders: [],
    });
  });

  it('uses the same durable projection for persistence, equality, and backend encoding', () => {
    const projected = projectDurablePreferences({
      ...durable,
      hydrated: true,
      syncing: true,
      lastSyncError: 'ignored',
    });

    expect(projected).toEqual(durable);
    expect(durablePreferencesEqual(projected, { ...durable })).toBe(true);
    expect(
      durablePreferencesEqual(projected, {
        ...durable,
        hiddenViews: ['annotation'],
      }),
    ).toBe(false);
    expect(encodePreferencesUpdate(projected)).toEqual({
      hidden_views: ['quotation'],
      favorite_workspaces: ['workspace-1'],
      default_tokenizer_model: 'model-a',
      ldaca_oni_api_token: 'oni-token',
      analysis_multi_tab_enabled: true,
      annotation_ai: {
        api_keys: { openai: 'key' },
        custom_providers: [{ id: 'custom:1', name: 'Local', base_url: 'http://localhost:9000' }],
      },
    });
  });
});
