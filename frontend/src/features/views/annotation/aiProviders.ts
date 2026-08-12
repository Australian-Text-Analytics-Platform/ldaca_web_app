import type { AnnotationProviderConfigurationResource } from '@/api';

export type AnnotationProviderType = AnnotationProviderConfigurationResource['provider'];

export interface AnnotationProviderDefinition {
  id: AnnotationProviderType;
  label: string;
  requiresApiKey: boolean;
}

export const ANNOTATION_PROVIDER_DEFINITIONS = [
  { id: 'openrouter', label: 'OpenRouter', requiresApiKey: true },
  { id: 'openai', label: 'OpenAI', requiresApiKey: true },
  { id: 'anthropic', label: 'Anthropic', requiresApiKey: true },
  { id: 'google', label: 'Google', requiresApiKey: true },
  { id: 'custom', label: 'Custom', requiresApiKey: false },
] as const satisfies readonly AnnotationProviderDefinition[];

export function getProviderDefinition(type: AnnotationProviderType): AnnotationProviderDefinition {
  const definition = ANNOTATION_PROVIDER_DEFINITIONS.find((provider) => provider.id === type);
  if (!definition) throw new Error(`Unsupported Annotation provider: ${type}`);
  return definition;
}

export function providerConfigurationSecondaryText(
  configuration: AnnotationProviderConfigurationResource,
): string {
  if (configuration.provider !== 'custom') {
    return getProviderDefinition(configuration.provider).label;
  }
  if (!configuration.base_url) {
    throw new Error('Custom Annotation provider is missing its base URL');
  }
  return configuration.base_url;
}

export function canListModels(
  configuration: AnnotationProviderConfigurationResource | null,
): boolean {
  if (!configuration) return false;
  return configuration.provider === 'custom' || configuration.has_api_key;
}

export function canAnnotate(
  configuration: AnnotationProviderConfigurationResource | null,
  model: string,
): boolean {
  return canListModels(configuration) && model.trim().length > 0;
}

/** Resolve a saved selection without silently switching a tab to another account.
 *
 * A missing persisted UUID means its configuration was deleted, so callers clear
 * that tab. Only a genuinely fresh tab may choose the first usable connection.
 */
export function resolveAnnotationProviderConfiguration(
  configurations: AnnotationProviderConfigurationResource[],
  selectedId: string | null,
  selectedType: AnnotationProviderType | null,
): AnnotationProviderConfigurationResource | null {
  const selected = configurations.find((configuration) => configuration.id === selectedId);
  if (selected) return selected;
  if (selectedId || selectedType) return null;
  return configurations.find((configuration) => canListModels(configuration)) ?? null;
}
