/**
 * Built-in annotation provider metadata.
 *
 * The frontend stores only the selected provider and model in the tab's local
 * presentation state. Credential presence and request-time resolution come
 * through the mode-specific provider-credential facade.
 */

export type BuiltinAnnotationAiProviderId = 'openrouter' | 'openai' | 'anthropic' | 'google';
export type AnnotationAiProviderId = BuiltinAnnotationAiProviderId;

export interface AnnotationAiProvider {
  id: BuiltinAnnotationAiProviderId;
  requestProviderId: BuiltinAnnotationAiProviderId;
  label: string;
  requiresApiKey: boolean;
  supportsModelListing: boolean;
}

export const ANNOTATION_AI_PROVIDERS = [
  {
    id: 'openrouter',
    requestProviderId: 'openrouter',
    label: 'OpenRouter',
    requiresApiKey: true,
    supportsModelListing: true,
  },
  {
    id: 'openai',
    requestProviderId: 'openai',
    label: 'OpenAI',
    requiresApiKey: true,
    supportsModelListing: true,
  },
  {
    id: 'anthropic',
    requestProviderId: 'anthropic',
    label: 'Anthropic',
    requiresApiKey: true,
    supportsModelListing: true,
  },
  {
    id: 'google',
    requestProviderId: 'google',
    label: 'Google',
    requiresApiKey: true,
    supportsModelListing: true,
  },
] as const satisfies readonly AnnotationAiProvider[];

export function getBuiltinProvider(id: AnnotationAiProviderId): AnnotationAiProvider {
  return (
    ANNOTATION_AI_PROVIDERS.find((provider) => provider.id === id) ?? ANNOTATION_AI_PROVIDERS[0]
  );
}

export function canListModels(
  provider: AnnotationAiProvider,
  credentialConfigured: boolean,
): boolean {
  return provider.supportsModelListing && (!provider.requiresApiKey || credentialConfigured);
}

/** A class the model may assign, with an optional guiding description. */
export interface AnnotationClassOption {
  name: string;
  description: string;
}

export function canAnnotate(
  provider: AnnotationAiProvider,
  credentialConfigured: boolean,
  model: string,
): boolean {
  return credentialConfigured && model.trim().length > 0 && provider.id.length > 0;
}
