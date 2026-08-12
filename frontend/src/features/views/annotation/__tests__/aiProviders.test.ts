import { describe, expect, it } from 'vitest';

import type { AnnotationProviderConfigurationResource } from '@/api';
import { resolveAnnotationProviderConfiguration } from '../aiProviders';

const configurations: AnnotationProviderConfigurationResource[] = [
  {
    id: '74a93227-c081-4db9-af2e-ad357b62278d',
    name: 'OpenRouter personal',
    provider: 'openrouter',
    base_url: null,
    has_api_key: true,
  },
  {
    id: '8a342ceb-1ed6-433a-bc3f-75b6fd5dba38',
    name: 'OpenAI work',
    provider: 'openai',
    base_url: null,
    has_api_key: true,
  },
  {
    id: 'aa0295d2-c879-40a0-95b5-24c33fd28a43',
    name: 'OpenRouter org',
    provider: 'openrouter',
    base_url: null,
    has_api_key: true,
  },
];

describe('resolveAnnotationProviderConfiguration', () => {
  it('uses the first configured entry for a fresh tab', () => {
    expect(resolveAnnotationProviderConfiguration(configurations, null, null)?.id).toBe(
      configurations[0]!.id,
    );
  });

  it('clears a deleted configuration instead of switching to another account', () => {
    expect(
      resolveAnnotationProviderConfiguration(
        configurations.slice(1),
        configurations[0]!.id,
        'openrouter',
      ),
    ).toBeNull();
  });

  it('skips keyless built-ins when choosing a provider for a fresh tab', () => {
    expect(
      resolveAnnotationProviderConfiguration(
        [{ ...configurations[0]!, has_api_key: false }, configurations[1]!],
        null,
        null,
      )?.id,
    ).toBe(configurations[1]!.id);
  });

  it('does not fall across provider types when the selected type disappears', () => {
    expect(
      resolveAnnotationProviderConfiguration(configurations.slice(1, 2), 'deleted-id', 'custom'),
    ).toBeNull();
  });
});
