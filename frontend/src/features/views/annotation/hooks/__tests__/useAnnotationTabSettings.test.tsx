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
          aiProviderConfigurationId: '8a342ceb-1ed6-433a-bc3f-75b6fd5dba38',
          aiProviderType: 'openai',
          aiProviderModels: JSON.stringify({
            '8a342ceb-1ed6-433a-bc3f-75b6fd5dba38': 'gpt-4o',
          }),
          aiPrompt: 'Classify stance.',
          aiTemperature: '0.7',
          aiReasoningEnabled: 'true',
          aiReasoningEffort: 'high',
          annotationTargets: JSON.stringify({ 'source-node': 'annotation' }),
          annotationComparisonColumns: JSON.stringify({
            'source-node': ['reviewer_one', 'reviewer_two'],
          }),
        },
      }),
    );

    expect(result.current.annotationMode).toBe('ai');
    expect(result.current.aiProviderConfigurationId).toBe('8a342ceb-1ed6-433a-bc3f-75b6fd5dba38');
    expect(result.current.aiProviderType).toBe('openai');
    expect(result.current.aiProviderModels).toEqual({
      '8a342ceb-1ed6-433a-bc3f-75b6fd5dba38': 'gpt-4o',
    });
    expect(result.current.aiModel).toBe('gpt-4o');
    expect(result.current.aiPrompt).toBe('Classify stance.');
    expect(result.current.aiTemperature).toBe(0.7);
    expect(result.current.aiReasoningEnabled).toBe(true);
    expect(result.current.aiReasoningEffort).toBe('high');
    expect(result.current.annotationTargets).toEqual({ 'source-node': 'annotation' });
    expect(result.current.annotationComparisonColumns).toEqual({
      'source-node': ['reviewer_one', 'reviewer_two'],
    });
  });

  it('writes discrete setting changes through to the tab sink', () => {
    const onTabSettingChange = vi.fn();
    const { result } = renderHook(() =>
      useAnnotationTabSettings({ tabSettings: {}, onTabSettingChange }),
    );

    act(() => {
      result.current.setAnnotationMode('ai');
      result.current.selectAiProvider(
        '74a93227-c081-4db9-af2e-ad357b62278d',
        'openrouter',
        'openai/gpt-4o',
      );
      result.current.persistAiProviderModels({
        '74a93227-c081-4db9-af2e-ad357b62278d': 'openai/gpt-4o',
      });
      result.current.commitAiPrompt('Use concise labels.');
      result.current.commitAiTemperature(0.3);
      result.current.setAiReasoningEnabled(true);
      result.current.setAiReasoningEffort('low');
      result.current.setAnnotationTarget('source-node', 'existing_annotation');
      result.current.setAnnotationComparisonColumns('source-node', [
        'reviewer_one',
        'reviewer_two',
      ]);
    });

    expect(onTabSettingChange).toHaveBeenCalledWith('annotationMode', 'ai');
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'aiProviderConfigurationId',
      '74a93227-c081-4db9-af2e-ad357b62278d',
    );
    expect(onTabSettingChange).toHaveBeenCalledWith('aiProviderType', 'openrouter');
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'aiProviderModels',
      JSON.stringify({ '74a93227-c081-4db9-af2e-ad357b62278d': 'openai/gpt-4o' }),
    );
    expect(onTabSettingChange).toHaveBeenCalledWith('aiPrompt', 'Use concise labels.');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiTemperature', '0.3');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiReasoningEnabled', 'true');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiReasoningEffort', 'low');
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'annotationTargets',
      JSON.stringify({ 'source-node': 'existing_annotation' }),
    );
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'annotationComparisonColumns',
      JSON.stringify({ 'source-node': ['reviewer_one', 'reviewer_two'] }),
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
          aiProviderConfigurationId: '74a93227-c081-4db9-af2e-ad357b62278d',
          aiProviderType: 'openrouter',
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

  it('clears a missing configuration without erasing its provider type', () => {
    const onTabSettingChange = vi.fn();
    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        onTabSettingChange,
        tabSettings: {
          aiProviderConfigurationId: '74a93227-c081-4db9-af2e-ad357b62278d',
          aiProviderType: 'openrouter',
        },
      }),
    );

    act(() => {
      result.current.clearAiProvider();
    });

    expect(result.current.aiProviderConfigurationId).toBeNull();
    expect(result.current.aiProviderType).toBe('openrouter');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiProviderConfigurationId', '');
  });
});
