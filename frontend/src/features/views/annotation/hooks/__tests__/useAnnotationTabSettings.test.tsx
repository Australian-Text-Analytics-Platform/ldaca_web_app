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
          aiMaxRetriesPerBatch: '4',
          aiBatchSize: '17',
          aiProcessingMode: 'fill_missing',
          aiReasoningEnabled: 'true',
          aiReasoningEffort: 'high',
          annotationTargets: JSON.stringify({ 'source-node': 'annotation' }),
          annotationComparisonColumns: JSON.stringify({
            'source-node': ['reviewer_one', 'reviewer_two'],
          }),
          annotationDifferenceFilters: JSON.stringify({
            'source-node': { kind: 'column', column: 'reviewer_two' },
          }),
          annotationReliabilityMetrics: JSON.stringify({
            'source-node': 'krippendorffs_alpha',
          }),
          annotationMetadataColumns: JSON.stringify({
            'source-node': ['username', 'created_at'],
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
    expect(result.current.aiMaxRetriesPerBatch).toBe(4);
    expect(result.current.aiBatchSize).toBe(17);
    expect(result.current.aiProcessingMode).toBe('fill_missing');
    expect(result.current.aiReasoningEnabled).toBe(true);
    expect(result.current.aiReasoningEffort).toBe('high');
    expect(result.current.annotationTargets).toEqual({ 'source-node': 'annotation' });
    expect(result.current.annotationComparisonColumns).toEqual({
      'source-node': ['reviewer_one', 'reviewer_two'],
    });
    expect(result.current.annotationDifferenceFilters).toEqual({
      'source-node': { kind: 'column', column: 'reviewer_two' },
    });
    expect(result.current.annotationReliabilityMetrics).toEqual({
      'source-node': 'krippendorffs_alpha',
    });
    expect(result.current.annotationMetadataColumns).toEqual({
      'source-node': ['username', 'created_at'],
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
      result.current.commitAiMaxRetriesPerBatch(2);
      result.current.commitAiBatchSize(25);
      result.current.setAiProcessingMode('fill_missing');
      result.current.setAiReasoningEnabled(true);
      result.current.setAiReasoningEffort('low');
      result.current.setAnnotationTarget('source-node', 'existing_annotation');
      result.current.setAnnotationComparisonColumns('source-node', [
        'reviewer_one',
        'reviewer_two',
      ]);
      result.current.setAnnotationReliabilityMetric('source-node', 'percent_agreement');
      result.current.setAnnotationMetadataColumns('source-node', ['username', 'created_at']);
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
    expect(onTabSettingChange).toHaveBeenCalledWith('aiMaxRetriesPerBatch', '2');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiBatchSize', '25');
    expect(onTabSettingChange).toHaveBeenCalledWith('aiProcessingMode', 'fill_missing');
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
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'annotationReliabilityMetrics',
      JSON.stringify({ 'source-node': 'percent_agreement' }),
    );
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'annotationMetadataColumns',
      JSON.stringify({ 'source-node': ['username', 'created_at'] }),
    );
  });

  it('persists one exclusive filter per Data Block and prunes a deselected target', () => {
    const onTabSettingChange = vi.fn();
    const { result } = renderHook(() =>
      useAnnotationTabSettings({ tabSettings: {}, onTabSettingChange }),
    );

    act(() => {
      result.current.setAnnotationComparisonColumns('source-node', [
        'reviewer_one',
        'reviewer_two',
      ]);
      result.current.setAnnotationDifferenceFilter('source-node', { kind: 'any' });
    });
    expect(result.current.annotationDifferenceFilters).toEqual({
      'source-node': { kind: 'any' },
    });

    act(() => {
      result.current.setAnnotationDifferenceFilter('source-node', {
        kind: 'column',
        column: 'reviewer_one',
      });
    });
    expect(result.current.annotationDifferenceFilters).toEqual({
      'source-node': { kind: 'column', column: 'reviewer_one' },
    });

    act(() => {
      result.current.setAnnotationComparisonColumns('source-node', ['reviewer_two']);
    });
    expect(result.current.annotationDifferenceFilters).toEqual({});
    expect(onTabSettingChange).toHaveBeenLastCalledWith('annotationDifferenceFilters', '{}');
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
