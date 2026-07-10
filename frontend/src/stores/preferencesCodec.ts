import type { AnnotationAiCustomProvider, UserPreferences, UserPreferencesUpdate } from '@/api';

/** Durable preference shape shared by local persistence and backend transport. */
export interface DurablePreferences {
  hiddenViews: string[];
  favoriteWorkspaces: string[];
  defaultTokenizerModel: string | null;
  ldacaOniApiToken: string | null;
  analysisMultiTabEnabled: boolean;
  annotationAiApiKeys: Record<string, string>;
  annotationAiCustomProviders: AnnotationAiCustomProvider[];
}

/** Applies backend defaults at the single server-to-store boundary. */
export const normalizeServerPreferences = (data: Partial<UserPreferences>): DurablePreferences => ({
  hiddenViews: data.hidden_views ?? [],
  favoriteWorkspaces: data.favorite_workspaces ?? [],
  defaultTokenizerModel: data.default_tokenizer_model ?? null,
  ldacaOniApiToken: data.ldaca_oni_api_token ?? null,
  analysisMultiTabEnabled: data.analysis_multi_tab_enabled ?? false,
  annotationAiApiKeys: data.annotation_ai?.api_keys ?? {},
  annotationAiCustomProviders: data.annotation_ai?.custom_providers ?? [],
});

/** Projects any store-like value onto the durable local preference contract. */
// The generic deliberately accepts Zustand's larger state object while returning only durable fields.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export const projectDurablePreferences = <State extends DurablePreferences>(
  state: State,
): DurablePreferences => ({
  hiddenViews: state.hiddenViews,
  favoriteWorkspaces: state.favoriteWorkspaces,
  defaultTokenizerModel: state.defaultTokenizerModel,
  ldacaOniApiToken: state.ldacaOniApiToken,
  analysisMultiTabEnabled: state.analysisMultiTabEnabled,
  annotationAiApiKeys: state.annotationAiApiKeys,
  annotationAiCustomProviders: state.annotationAiCustomProviders,
});

/** Encodes the durable frontend shape for the generated preferences endpoint. */
export const encodePreferencesUpdate = (
  preferences: DurablePreferences,
): UserPreferencesUpdate => ({
  hidden_views: preferences.hiddenViews,
  favorite_workspaces: preferences.favoriteWorkspaces,
  ...(preferences.defaultTokenizerModel !== null
    ? { default_tokenizer_model: preferences.defaultTokenizerModel }
    : {}),
  ldaca_oni_api_token: preferences.ldacaOniApiToken,
  analysis_multi_tab_enabled: preferences.analysisMultiTabEnabled,
  annotation_ai: {
    api_keys: preferences.annotationAiApiKeys,
    custom_providers: preferences.annotationAiCustomProviders,
  },
});

/** Compares only durable fields so hydration/sync flags never trigger writes. */
export const durablePreferencesEqual = (a: DurablePreferences, b: DurablePreferences): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
