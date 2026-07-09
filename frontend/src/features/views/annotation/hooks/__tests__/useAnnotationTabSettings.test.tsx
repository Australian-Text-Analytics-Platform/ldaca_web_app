import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAnnotationTabSettings } from '../useAnnotationTabSettings';

describe('useAnnotationTabSettings', () => {
  it('hydrates AI settings from persisted tab strings', () => {
    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        tabSettings: {
          annotationMode: 'ai',
          aiProvider: 'provider:openai:test',
          aiProviderModels: JSON.stringify({ 'provider:openai:test': 'gpt-4o' }),
          aiModel: 'fallback-model',
          aiPrompt: 'Classify stance.',
          aiTemperature: '0.7',
          aiReasoningEnabled: 'true',
          aiReasoningEffort: 'high',
          aiPreviewOpen: 'true',
        },
      }),
    );

    expect(result.current.annotationMode).toBe('ai');
    expect(result.current.aiProvider).toBe('provider:openai:test');
    expect(result.current.aiProviderModels).toEqual({ 'provider:openai:test': 'gpt-4o' });
    expect(result.current.aiModel).toBe('gpt-4o');
    expect(result.current.aiPrompt).toBe('Classify stance.');
    expect(result.current.aiTemperature).toBe(0.7);
    expect(result.current.aiReasoningEnabled).toBe(true);
    expect(result.current.aiReasoningEffort).toBe('high');
    expect(result.current.isPreviewing).toBe(true);
  });

  it('writes discrete setting changes through to the tab sink', () => {
    const onTabSettingChange = vi.fn();
    const { result } = renderHook(() => useAnnotationTabSettings({ onTabSettingChange }));

    act(() => {
      result.current.setAnnotationMode('ai');
      result.current.selectAiProvider('openrouter', 'openai/gpt-4o');
      result.current.persistAiProviderModels({ openrouter: 'openai/gpt-4o' });
      result.current.commitAiPrompt('Use concise labels.');
      result.current.commitAiTemperature(0.3);
      result.current.setAiReasoningEnabled(true);
      result.current.setAiReasoningEffort('low');
      result.current.setIsPreviewing(true);
    });

    expect(onTabSettingChange).toHaveBeenCalledWith('annotationMode', 'ai');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiProvider', 'openrouter');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiModel', 'openai/gpt-4o');
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'aiProviderModels',
      JSON.stringify({ openrouter: 'openai/gpt-4o' }),
    );
    expect(onTabSettingChange).toHaveBeenCalledWith('aiPrompt', 'Use concise labels.');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiTemperature', '0.3');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiReasoningEnabled', 'true');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiReasoningEffort', 'low');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiPreviewOpen', 'true');
  });

  it('ignores malformed persisted provider-model maps', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        tabSettings: {
          aiProvider: 'openrouter',
          aiProviderModels: '{broken',
          aiModel: 'fallback-model',
        },
      }),
    );

    expect(result.current.aiProviderModels).toEqual({});
    expect(result.current.aiModel).toBe('fallback-model');
    expect(warnSpy).toHaveBeenCalledWith(
      '[annotation] Ignoring malformed AI provider model setting:',
      expect.any(SyntaxError),
    );

    warnSpy.mockRestore();
  });
});
