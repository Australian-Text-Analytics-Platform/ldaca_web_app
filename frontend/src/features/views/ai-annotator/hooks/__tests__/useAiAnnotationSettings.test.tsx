import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LMSTUDIO_BASE_URL, useAiAnnotationSettings } from '../useAiAnnotationSettings';

describe('useAiAnnotationSettings', () => {
  it('parses default classes and resolves the OpenAI endpoint to the backend default', () => {
    const { result } = renderHook(() => useAiAnnotationSettings());

    expect(result.current.parsedClasses).toEqual([
      { name: 'support', description: 'Supportive stance' },
      { name: 'critical', description: 'Critical stance' },
    ]);
    expect(result.current.parsedExamples).toEqual([]);
    expect(result.current.baseUrl).toBeNull();
  });

  it('updates request fields, parses examples, and resolves local/custom endpoints', () => {
    const { result } = renderHook(() => useAiAnnotationSettings());

    act(() => {
      result.current.setEndpointPreset('lmstudio');
      result.current.setClassesText('alpha: First class\nbeta');
      result.current.setExamplesText('some source text => alpha\ninvalid example');
      result.current.setModel('local-model');
    });

    expect(result.current.baseUrl).toBe(LMSTUDIO_BASE_URL);
    expect(result.current.model).toBe('local-model');
    expect(result.current.parsedClasses).toEqual([
      { name: 'alpha', description: 'First class' },
      { name: 'beta', description: 'beta' },
    ]);
    expect(result.current.parsedExamples).toEqual([
      { query: 'some source text', classification: 'alpha' },
    ]);

    act(() => {
      result.current.setEndpointPreset('custom');
      result.current.setCustomBaseUrl('  http://localhost:11434/v1  ');
    });

    expect(result.current.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('resets all settings back to their request defaults', () => {
    const { result } = renderHook(() => useAiAnnotationSettings());

    act(() => {
      result.current.setEndpointPreset('custom');
      result.current.setModel('changed-model');
      result.current.setClassesText('other: Other class');
      result.current.setApiKey('secret');
      result.current.setBatchSize('25');
    });

    expect(result.current.endpointPreset).toBe('custom');
    expect(result.current.model).toBe('changed-model');
    expect(result.current.apiKey).toBe('secret');

    act(() => {
      result.current.resetSettings();
    });

    expect(result.current.endpointPreset).toBe('openai');
    expect(result.current.model).toBe('');
    expect(result.current.apiKey).toBe('');
    expect(result.current.batchSize).toBe('100');
    expect(result.current.parsedClasses).toEqual([
      { name: 'support', description: 'Supportive stance' },
      { name: 'critical', description: 'Critical stance' },
    ]);
  });
});
