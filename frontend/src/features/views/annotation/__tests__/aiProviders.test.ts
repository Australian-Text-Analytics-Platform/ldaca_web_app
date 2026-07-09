import { describe, expect, it } from 'vitest';

import {
  ANNOTATION_AI_PROVIDERS,
  buildAnnotationAiProviders,
  canAnnotate,
  canListModels,
  makeCustomProvider,
  parseConfiguredBuiltinProviderId,
  resolveAnnotationAiProvider,
} from '../aiProviders';

// aiProviders is now pure metadata: all LLM traffic (preview, annotate-all, and
// model listing) runs server-side under /annotation/ai/*, so these tests only
// exercise the provider catalogue and the client-side gating helpers that decide
// when the model dropdown and the Preview button light up.

const provider = (id: string) => {
  const resolved = resolveAnnotationAiProvider(id, []);
  if (!resolved) throw new Error(`Test provider did not resolve: ${id}`);
  return resolved;
};
// A user-defined custom provider stands in for a saved "Custom…" endpoint.
const customProvider = makeCustomProvider({
  id: 'custom:test',
  name: 'My LLM',
  base_url: 'https://llm.example/v1',
});

describe('aiProviders metadata', () => {
  it('exposes the expected built-in provider ids in order', () => {
    expect(ANNOTATION_AI_PROVIDERS.map((p) => p.id)).toEqual([
      'openrouter',
      'openai',
      'anthropic',
      'google',
    ]);
  });

  it('marks only OpenRouter as key-optional and all built-ins as listable', () => {
    expect(provider('openrouter').requiresApiKey).toBe(false);
    expect(provider('openai').requiresApiKey).toBe(true);
    expect(provider('anthropic').requiresApiKey).toBe(true);
    expect(provider('google').requiresApiKey).toBe(true);
    for (const p of ANNOTATION_AI_PROVIDERS) {
      expect(p.supportsModelListing).toBe(true);
    }
  });

  it('labels Google without the Gemini suffix', () => {
    expect(provider('google').label).toBe('Google');
  });

  it('returns null for an unknown id', () => {
    expect(resolveAnnotationAiProvider('nope', [])).toBeNull();
  });

  it('resolves configured built-in provider cards through their base provider id', () => {
    const resolved = resolveAnnotationAiProvider('provider:openai:test-card', []);
    expect(resolved).not.toBeNull();
    if (!resolved) throw new Error('Expected configured provider to resolve');
    expect(parseConfiguredBuiltinProviderId(resolved.id)).toBe('openai');
    expect(resolved.label).toBe('OpenAI');
    expect(resolved.requestProviderId).toBe('openai');
  });
});

describe('makeCustomProvider / buildAnnotationAiProviders', () => {
  it('wraps a saved custom def as a key-optional, listable provider', () => {
    expect(customProvider).toEqual({
      id: 'custom:test',
      requestProviderId: 'custom:test',
      label: 'My LLM',
      baseUrl: 'https://llm.example/v1',
      isCustom: true,
      requiresApiKey: false,
      supportsModelListing: true,
    });
  });

  it('appends custom providers after the built-ins', () => {
    const all = buildAnnotationAiProviders([
      { id: 'custom:test', name: 'My LLM', base_url: 'https://llm.example/v1' },
    ]);
    expect(all.map((p) => p.id)).toEqual([
      'openrouter',
      'openai',
      'anthropic',
      'google',
      'custom:test',
    ]);
  });

  it('resolves a saved custom provider by id', () => {
    const resolved = resolveAnnotationAiProvider('custom:test', [
      { id: 'custom:test', name: 'My LLM', base_url: 'https://llm.example/v1' },
    ]);
    expect(resolved).not.toBeNull();
    if (!resolved) throw new Error('Expected custom provider to resolve');
    expect(resolved.id).toBe('custom:test');
    expect(resolved.label).toBe('My LLM');
    expect(resolved.baseUrl).toBe('https://llm.example/v1');
    expect(resolved.isCustom).toBe(true);
    expect(resolved.supportsModelListing).toBe(true);
  });
});

describe('canListModels', () => {
  it('allows OpenRouter without a key', () => {
    expect(canListModels(provider('openrouter'), '')).toBe(true);
  });

  it('requires a key for keyed providers', () => {
    expect(canListModels(provider('openai'), '')).toBe(false);
    expect(canListModels(provider('openai'), '  ')).toBe(false);
    expect(canListModels(provider('openai'), 'sk-1')).toBe(true);
    expect(canListModels(provider('google'), 'g')).toBe(true);
  });

  it('lists models for custom providers (OpenAI-compatible, key optional)', () => {
    expect(canListModels(customProvider, 'anything')).toBe(true);
    // Even with no key, since custom endpoints treat the key as optional.
    expect(canListModels(customProvider, '')).toBe(true);
  });
});

describe('canAnnotate', () => {
  it('requires a non-empty model for every provider', () => {
    expect(canAnnotate(provider('openai'), 'sk-1', '   ')).toBe(false);
    expect(canAnnotate(customProvider, '', '')).toBe(false);
  });

  it('requires a key for hosted providers (even OpenRouter, which needs credits)', () => {
    expect(canAnnotate(provider('openrouter'), '', 'gpt-4o')).toBe(false);
    expect(canAnnotate(provider('openai'), '  ', 'gpt-4o')).toBe(false);
    expect(canAnnotate(provider('openai'), 'sk-1', 'gpt-4o')).toBe(true);
    expect(canAnnotate(provider('anthropic'), 'sk-ant', 'claude')).toBe(true);
  });

  it('treats the key as optional for custom providers', () => {
    expect(canAnnotate(customProvider, '', 'local-model')).toBe(true);
  });
});
