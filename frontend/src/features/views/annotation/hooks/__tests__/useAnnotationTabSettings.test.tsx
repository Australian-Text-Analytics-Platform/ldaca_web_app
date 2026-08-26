import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAnnotationTabSettings } from '../useAnnotationTabSettings';
import {
  ANNOTATION_TAB_SETTINGS_KEY,
  DEFAULT_ANNOTATION_TAB_SETTINGS,
} from '../../annotationTabSettings';

const storedSettings = (
  values: Partial<typeof DEFAULT_ANNOTATION_TAB_SETTINGS>,
): Record<string, string> => ({
  [ANNOTATION_TAB_SETTINGS_KEY]: JSON.stringify({
    ...DEFAULT_ANNOTATION_TAB_SETTINGS,
    ...values,
  }),
});

describe('useAnnotationTabSettings', () => {
  it('hydrates AI settings from persisted tab strings', () => {
    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        onTabSettingChange: vi.fn(),
        tabSettings: storedSettings({
          annotationMode: 'ai',
          aiProviderConfigurationId: '8a342ceb-1ed6-433a-bc3f-75b6fd5dba38',
          aiProviderType: 'openai',
          aiProviderModels: {
            '8a342ceb-1ed6-433a-bc3f-75b6fd5dba38': 'gpt-4o',
          },
          aiPrompt: 'Classify stance.',
          aiTemperature: 0.7,
          aiMaxRetriesPerBatch: 4,
          aiMaxExamplesPerClass: 7,
          aiExampleSamplingMethod: 'last_n',
          aiExampleRandomSeed: 42,
          aiBatchSize: 17,
          aiProcessingMode: 'fill_missing',
          aiReasoningEnabled: true,
          aiReasoningEffort: 'high',
          annotationTargets: { 'source-node': 'annotation' },
          annotationComparisonColumns: {
            'source-node': ['reviewer_one', 'reviewer_two'],
          },
          annotationReliabilityMetrics: {
            'source-node': 'krippendorffs_alpha',
          },
          annotationMetadataColumns: {
            'source-node': ['username', 'reviewer_two', 'created_at'],
          },
        }),
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
    expect(result.current.aiMaxExamplesPerClass).toBe(7);
    expect(result.current.aiExampleSamplingMethod).toBe('last_n');
    expect(result.current.aiExampleRandomSeed).toBe(42);
    expect(result.current.aiBatchSize).toBe(17);
    expect(result.current.aiProcessingMode).toBe('fill_missing');
    expect(result.current.aiReasoningEnabled).toBe(true);
    expect(result.current.aiReasoningEffort).toBe('high');
    expect(result.current.annotationTargets).toEqual({ 'source-node': 'annotation' });
    expect(result.current.annotationComparisonColumns).toEqual({
      'source-node': ['reviewer_one', 'reviewer_two'],
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
      result.current.commitAiMaxExamplesPerClass(12);
      result.current.setAiExampleSamplingMethod('first_n');
      result.current.commitAiExampleRandomSeed(9);
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

    expect(
      onTabSettingChange.mock.calls.every(([key]) => key === ANNOTATION_TAB_SETTINGS_KEY),
    ).toBe(true);
    expect(JSON.parse(onTabSettingChange.mock.lastCall?.[1] ?? '{}')).toMatchObject({
      annotationMode: 'ai',
      aiProviderConfigurationId: '74a93227-c081-4db9-af2e-ad357b62278d',
      aiProviderType: 'openrouter',
      aiProviderModels: {
        '74a93227-c081-4db9-af2e-ad357b62278d': 'openai/gpt-4o',
      },
      aiPrompt: 'Use concise labels.',
      aiTemperature: 0.3,
      aiMaxRetriesPerBatch: 2,
      aiMaxExamplesPerClass: 12,
      aiExampleSamplingMethod: 'first_n',
      aiExampleRandomSeed: 9,
      aiBatchSize: 25,
      aiProcessingMode: 'fill_missing',
      aiReasoningEnabled: true,
      aiReasoningEffort: 'low',
      annotationTargets: { 'source-node': 'existing_annotation' },
      annotationComparisonColumns: { 'source-node': ['reviewer_one', 'reviewer_two'] },
      annotationReliabilityMetrics: { 'source-node': 'percent_agreement' },
      annotationMetadataColumns: { 'source-node': ['username', 'created_at'] },
    });
  });

  it('gives Compare To precedence when saved settings overlap', () => {
    const onTabSettingChange = vi.fn();
    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        onTabSettingChange,
        tabSettings: storedSettings({
          annotationComparisonColumns: {
            'source-node': ['reviewer_one'],
          },
          annotationMetadataColumns: {
            'source-node': ['reviewer_one', 'username'],
          },
        }),
      }),
    );

    expect(result.current.annotationComparisonColumns).toEqual({
      'source-node': ['reviewer_one'],
    });
    expect(result.current.annotationMetadataColumns).toEqual({
      'source-node': ['username'],
    });
  });

  it('excludes the active Correction column from both column roles', () => {
    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        onTabSettingChange: vi.fn(),
        excludedRoleColumns: { 'source-node': 'correction' },
        tabSettings: storedSettings({
          annotationComparisonColumns: {
            'source-node': ['reviewer_one', 'correction'],
          },
          annotationMetadataColumns: {
            'source-node': ['username', 'correction'],
          },
        }),
      }),
    );

    expect(result.current.annotationComparisonColumns).toEqual({
      'source-node': ['reviewer_one'],
    });
    expect(result.current.annotationMetadataColumns).toEqual({
      'source-node': ['username'],
    });
  });

  it('keeps comparison and metadata roles mutually exclusive', () => {
    const onTabSettingChange = vi.fn();
    const { result } = renderHook(() =>
      useAnnotationTabSettings({ tabSettings: {}, onTabSettingChange }),
    );

    act(() => {
      result.current.setAnnotationMetadataColumns('source-node', ['username', 'reviewer_one']);
      result.current.setAnnotationComparisonColumns('source-node', ['reviewer_one']);
    });
    expect(result.current.annotationComparisonColumns).toEqual({
      'source-node': ['reviewer_one'],
    });
    expect(result.current.annotationMetadataColumns).toEqual({
      'source-node': ['username'],
    });

    act(() => {
      result.current.setAnnotationMetadataColumns('source-node', ['reviewer_one']);
    });
    expect(result.current.annotationComparisonColumns).toEqual({});
    expect(result.current.annotationMetadataColumns).toEqual({
      'source-node': ['reviewer_one'],
    });
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
    expect(onTabSettingChange.mock.lastCall?.[0]).toBe(ANNOTATION_TAB_SETTINGS_KEY);
    expect(JSON.parse(onTabSettingChange.mock.lastCall?.[1] ?? '{}').annotationTargets).toEqual({
      'source-one': 'label_one',
      'source-two': 'label_two',
    });
  });

  it('ignores malformed persisted provider-model maps', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        onTabSettingChange: vi.fn(),
        tabSettings: { [ANNOTATION_TAB_SETTINGS_KEY]: '{broken' },
      }),
    );

    expect(result.current.aiProviderModels).toEqual({});
    expect(result.current.aiModel).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      '[annotation] Ignoring malformed tab settings:',
      expect.any(SyntaxError),
    );

    warnSpy.mockRestore();
  });

  it('clears a missing configuration, provider type, and current model', () => {
    const onTabSettingChange = vi.fn();
    const { result } = renderHook(() =>
      useAnnotationTabSettings({
        onTabSettingChange,
        tabSettings: storedSettings({
          aiProviderConfigurationId: '74a93227-c081-4db9-af2e-ad357b62278d',
          aiProviderType: 'openrouter',
        }),
      }),
    );

    act(() => {
      result.current.clearAiProvider();
    });

    expect(result.current.aiProviderConfigurationId).toBeNull();
    expect(result.current.aiProviderType).toBeNull();
    expect(result.current.aiModel).toBe('');
    expect(JSON.parse(onTabSettingChange.mock.lastCall?.[1] ?? '{}')).toMatchObject({
      aiProviderConfigurationId: null,
      aiProviderType: null,
    });
  });
});
