import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAnnotationTabSettings } from '../useAnnotationTabSettings';

describe('useAnnotationTabSettings', () => {
  it('hydrates AI settings from persisted tab strings', () => {
    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        onTabSettingChange: vi.fn(),
        tabSettings: {
          annotationMode: 'ai',
          aiProvider: 'openai',
          aiProviderModels: JSON.stringify({ openai: 'gpt-4o' }),
          aiPrompt: 'Classify stance.',
          aiTemperature: '0.7',
          aiReasoningEnabled: 'true',
          aiReasoningEffort: 'high',
          annotationTargets: JSON.stringify({ 'source-node': 'annotation' }),
        },
      }),
    );

    expect(result.current.annotationMode).toBe('ai');
    expect(result.current.aiProvider).toBe('openai');
    expect(result.current.aiProviderModels).toEqual({ openai: 'gpt-4o' });
    expect(result.current.aiModel).toBe('gpt-4o');
    expect(result.current.aiPrompt).toBe('Classify stance.');
    expect(result.current.aiTemperature).toBe(0.7);
    expect(result.current.aiReasoningEnabled).toBe(true);
    expect(result.current.aiReasoningEffort).toBe('high');
    expect(result.current.annotationTargets).toEqual({ 'source-node': 'annotation' });
  });

  it('writes discrete setting changes through to the tab sink', () => {
    const onTabSettingChange = vi.fn();
    const { result } = renderHook(() =>
      useAnnotationTabSettings({ tabSettings: {}, onTabSettingChange }),
    );

    act(() => {
      result.current.setAnnotationMode('ai');
      result.current.selectAiProvider('openrouter', 'openai/gpt-4o');
      result.current.persistAiProviderModels({ openrouter: 'openai/gpt-4o' });
      result.current.commitAiPrompt('Use concise labels.');
      result.current.commitAiTemperature(0.3);
      result.current.setAiReasoningEnabled(true);
      result.current.setAiReasoningEffort('low');
      result.current.setAnnotationTarget('source-node', 'existing_annotation');
    });

    expect(onTabSettingChange).toHaveBeenCalledWith('annotationMode', 'ai');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiProvider', 'openrouter');
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'aiProviderModels',
      JSON.stringify({ openrouter: 'openai/gpt-4o' }),
    );
    expect(onTabSettingChange).toHaveBeenCalledWith('aiPrompt', 'Use concise labels.');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiTemperature', '0.3');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiReasoningEnabled', 'true');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiReasoningEffort', 'low');
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'annotationTargets',
      JSON.stringify({ 'source-node': 'existing_annotation' }),
    );
  });

  it('retains every target when two selectors persist before React rerenders', () => {
    const onTabSettingChange = vi.fn();
    const { result } = renderHook(() =>
      useAnnotationTabSettings({ tabSettings: {}, onTabSettingChange }),
    );

    act(() => {
      result.current.setAnnotationTarget('source-one', 'label_one');
      result.current.setAnnotationTarget('source-two', 'label_two');
    });

    expect(result.current.annotationTargets).toEqual({
      'source-one': 'label_one',
      'source-two': 'label_two',
    });
    expect(onTabSettingChange).toHaveBeenLastCalledWith(
      'annotationTargets',
      JSON.stringify({
        'source-one': 'label_one',
        'source-two': 'label_two',
      }),
    );
  });

  it('ignores malformed persisted provider-model maps', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        onTabSettingChange: vi.fn(),
        tabSettings: {
          aiProvider: 'openrouter',
          aiProviderModels: '{broken',
        },
      }),
    );

    expect(result.current.aiProviderModels).toEqual({});
    expect(result.current.aiModel).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      '[annotation] Ignoring malformed AI provider model setting:',
      expect.any(SyntaxError),
    );

    warnSpy.mockRestore();
  });
});
