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

/** Resolve a saved selection, then the first same-type fallback, then a fresh default. */
export function resolveAnnotationProviderConfiguration(
  configurations: AnnotationProviderConfigurationResource[],
  selectedId: string | null,
  selectedType: AnnotationProviderType | null,
): AnnotationProviderConfigurationResource | null {
  const selected = configurations.find((configuration) => configuration.id === selectedId);
  if (selected) return selected;
  if (selectedType) {
    return configurations.find((configuration) => configuration.provider === selectedType) ?? null;
  }
  return configurations[0] ?? null;
}
