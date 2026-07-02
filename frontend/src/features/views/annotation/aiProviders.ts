/**
 * Provider metadata + gating helpers for the Annotation tab's AI mode.
 *
 * Used by: AnnotationAiSettings (provider dropdown), ModelNameCombobox (model
 * picker), AnnotationFeature (Preview gating), and AnnotationAiPreviewPanel
 * (request shaping) because all four need one source of truth for which
 * providers exist, which require an API key, and which can have their models
 * listed by the backend.
 *
 * All actual LLM traffic (annotation preview, annotate-all, and model listing)
 * now runs server-side under `/annotation/ai/*`; the browser never calls a model
 * provider directly and no provider SDKs ship in the bundle. This module is pure
 * metadata: it maps a provider id to its display label, key requirement, and
 * (for built-ins) whether the backend exposes a model-listing endpoint for it.
 */
import type { AnnotationAiCustomProvider } from '@/api';

/**
 * Provider id. Built-ins use fixed literals (openrouter/openai/anthropic/google);
 * user-defined custom providers use opaque `custom:<uuid>` ids generated when the
 * user saves one, so the type is a plain string rather than a closed union.
 */
export type AnnotationAiProviderId = string;

export interface AnnotationAiProvider {
  id: AnnotationAiProviderId;
  /** Human-facing name shown in the provider dropdown. */
  label: string;
  /** True when annotation/listing calls need an API key (all hosted built-ins). */
  requiresApiKey: boolean;
  /** Base URL for a user-defined custom provider; undefined for built-ins. */
  baseUrl?: string;
  /** True for user-defined custom providers built via `makeCustomProvider`. */
  isCustom?: boolean;
  /**
   * True when the backend can enumerate this provider's models (via its native
   * SDK). Built-ins support it; custom OpenAI-compatible endpoints also opt in —
   * the backend lists them through the OpenAI SDK's `/models` route against their
   * base URL, and the field stays free-text if that route is missing.
   */
  supportsModelListing: boolean;
}

/**
 * Ordered built-in provider catalogue rendered by the AI-mode provider dropdown.
 * The order puts the no-key OpenRouter option first, then the major keyed
 * providers. User-defined custom providers are appended at runtime by
 * `buildAnnotationAiProviders`.
 */
export const ANNOTATION_AI_PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    requiresApiKey: false,
    supportsModelListing: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    requiresApiKey: true,
    supportsModelListing: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    requiresApiKey: true,
    supportsModelListing: true,
  },
  {
    id: 'google',
    label: 'Google',
    requiresApiKey: true,
    supportsModelListing: true,
  },
] as const satisfies readonly AnnotationAiProvider[];

/**
 * Wrap a persisted custom-provider definition as an `AnnotationAiProvider`.
 *
 * Custom providers are OpenAI-compatible endpoints the user registers via the
 * "Custom…" dialog. They are marked `supportsModelListing: true` so the model
 * field offers the same backend-backed dropdown as the built-ins: the backend
 * lists them through the OpenAI SDK's `/models` route against the provider's base
 * URL (local servers like Apple `fm serve`, Ollama, LM Studio, and vLLM expose
 * it). The field stays free-text either way, so an endpoint that lacks `/models`
 * just shows a dropdown error while the user can still type an id. The key is
 * optional (local servers often need none).
 *
 * Called by: buildAnnotationAiProviders/resolveAnnotationAiProvider when turning
 * the stored custom-provider list into selectable provider entries.
 */
export function makeCustomProvider(def: AnnotationAiCustomProvider): AnnotationAiProvider {
  return {
    id: def.id,
    label: def.name,
    baseUrl: def.base_url,
    isCustom: true,
    requiresApiKey: false,
    supportsModelListing: true,
  };
}

/**
 * Combine the built-in catalogue with the user's saved custom providers.
 * Called by: AnnotationAiSettings to render the provider dropdown and by
 * resolveAnnotationAiProvider for lookup.
 */
export function buildAnnotationAiProviders(
  customDefs: readonly AnnotationAiCustomProvider[],
): AnnotationAiProvider[] {
  return [...ANNOTATION_AI_PROVIDERS, ...customDefs.map(makeCustomProvider)];
}

/**
 * Look up a provider by id among the built-ins plus the supplied custom defs.
 * Falls back to the first built-in (OpenRouter) so the return type stays
 * non-nullable. Used by AnnotationAiSettings to resolve the active provider.
 */
export function resolveAnnotationAiProvider(
  id: AnnotationAiProviderId,
  customDefs: readonly AnnotationAiCustomProvider[],
): AnnotationAiProvider {
  return (
    buildAnnotationAiProviders(customDefs).find((candidate) => candidate.id === id) ??
    ANNOTATION_AI_PROVIDERS[0]
  );
}

/**
 * Whether the model field should offer the backend-backed filter dropdown for
 * this provider + key combination: the backend must support listing for the
 * provider, and any required key must be present. Called by ModelNameCombobox to
 * decide between the live dropdown and a plain text input, and to gate the fetch.
 */
export function canListModels(provider: AnnotationAiProvider, apiKey: string): boolean {
  if (!provider.supportsModelListing) return false;
  return !provider.requiresApiKey || apiKey.trim().length > 0;
}

/** A class the model may assign, with an optional guiding description. */
export interface AnnotationClassOption {
  name: string;
  description: string;
}

/**
 * Whether a provider + key + model combination can run the annotation call.
 * Called by AnnotationFeature to gate the Preview button and by
 * AnnotationAiPreviewPanel to gate the request. Annotation needs a key for every
 * hosted provider (even OpenRouter, whose listing is free); custom endpoints
 * treat the key as optional since local servers often need none.
 */
export function canAnnotate(
  provider: AnnotationAiProvider,
  apiKey: string,
  model: string,
): boolean {
  if (model.trim().length === 0) return false;
  if (provider.isCustom) return true;
  return apiKey.trim().length > 0;
}
