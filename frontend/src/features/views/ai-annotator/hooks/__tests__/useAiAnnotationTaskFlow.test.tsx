import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  aiAnnotationTaskResultPost,
  detachAiAnnotation,
  getAiAnnotationModels,
  runAiAnnotation,
} from '@/api';
import type { AiAnnotationResponse } from '@/api';
import { useAiAnnotationTaskFlow } from '../useAiAnnotationTaskFlow';

vi.mock('@/api', () => ({
  aiAnnotationTaskResultPost: vi.fn(),
  detachAiAnnotation: vi.fn(),
  getAiAnnotationModels: vi.fn(),
  runAiAnnotation: vi.fn(),
}));

const mockedAiAnnotationTaskResultPost = vi.mocked(aiAnnotationTaskResultPost);
const mockedDetachAiAnnotation = vi.mocked(detachAiAnnotation);
const mockedGetAiAnnotationModels = vi.mocked(getAiAnnotationModels);
const mockedRunAiAnnotation = vi.mocked(runAiAnnotation);

const buildResponse = (message = 'annotation complete'): AiAnnotationResponse => ({
  state: 'successful',
  message,
  metadata: { task_id: 'task-1' },
  data: {
    'node-1': {
      columns: ['text', 'annotation'],
      data: [{ text: 'row', annotation: 'support' }],
      metadata: { annotation_columns: ['annotation'] },
      pagination: {
        page: 1,
        page_size: 5,
        total_source_rows: 1,
        total_source_pages: 1,
        result_count: 1,
        has_next: false,
        has_prev: false,
      },
      sorting: { sort_by: null, descending: true },
    },
  },
});

const getAuthHeaders = vi.fn(() => ({ Authorization: 'Bearer test-token' }));
const setModel = vi.fn();
const resetSettings = vi.fn();
const setLocalTaskId = vi.fn();
const resolveTaskId = vi.fn(() => Promise.resolve('task-1'));
const clearResults = vi.fn(() => Promise.resolve());
const applyResponseResult = vi.fn();
const setIsPaging = vi.fn();
const setStatusMessage = vi.fn();

const defaultArgs = {
  currentWorkspaceId: null,
  selectedNodeId: 'node-1',
  selectedColumn: 'text',
  selectedNodeLabel: 'Node One',
  aiAnnotationColumn: '',
  parsedClasses: [{ name: 'support', description: 'Supportive stance' }],
  parsedExamples: [{ query: 'looks good', classification: 'support' }],
  model: 'gpt-test',
  setModel,
  apiKey: '',
  baseUrl: null,
  temperature: '0.7',
  topP: '0.9',
  seed: '42',
  batchSize: '25',
  endpointPreset: 'openai' as const,
  customBaseUrl: '',
  getAuthHeaders,
  setStatusMessage,
  localTaskId: null,
  resolveTaskId,
  setLocalTaskId,
  clearResults,
  resultRef: { current: null as AiAnnotationResponse | null },
  applyResponseResult,
  setIsPaging,
  resetSettings,
  defaultPageSize: 5,
};

describe('useAiAnnotationTaskFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRunAiAnnotation.mockResolvedValue({ data: buildResponse(), error: undefined });
    mockedAiAnnotationTaskResultPost.mockResolvedValue({
      data: buildResponse('page loaded'),
      error: undefined,
    });
    mockedDetachAiAnnotation.mockResolvedValue({
      data: {
        state: 'successful',
        message: 'detach started',
        data: { new_node_name: 'Node_One_ai_annotation', record_count: 1 },
      },
      error: undefined,
    });
    mockedGetAiAnnotationModels.mockResolvedValue({
      data: {
        state: 'successful',
        message: 'models loaded',
        data: {
          models: [
            { id: 'gpt-a', name: 'GPT A' },
            { id: 'gpt-b', name: 'GPT B' },
          ],
        },
      },
      error: undefined,
    });
  });

  it('runs annotation with the selected node, parsed settings, and default first page', async () => {
    const resultRef = { current: null as AiAnnotationResponse | null };
    const { result } = renderHook(() => useAiAnnotationTaskFlow({ ...defaultArgs, resultRef }));

    await act(async () => {
      await result.current.handleRun();
    });

    expect(mockedRunAiAnnotation).toHaveBeenCalledWith({
      body: expect.objectContaining({
        node_ids: ['node-1'],
        node_columns: { 'node-1': 'text' },
        annotation_column: null,
        classes: [{ name: 'support', description: 'Supportive stance' }],
        examples: [{ query: 'looks good', classification: 'support' }],
        model: 'gpt-test',
        api_key: null,
        base_url: null,
        temperature: 0.7,
        top_p: 0.9,
        seed: 42,
        batch_size: 25,
        page: 1,
        page_size: 5,
        descending: true,
      }),
      headers: { Authorization: 'Bearer test-token' },
      throwOnError: true,
    });
    expect(setLocalTaskId).toHaveBeenCalledWith('task-1');
    expect(resultRef.current).toEqual(buildResponse());
    expect(applyResponseResult).toHaveBeenCalledWith(buildResponse());
    expect(setStatusMessage).toHaveBeenCalledWith('annotation complete');
  });

  it('loads models and selects the first returned model when the current model is invalid', async () => {
    const { result } = renderHook(() =>
      useAiAnnotationTaskFlow({ ...defaultArgs, model: 'missing-model' }),
    );

    await act(async () => {
      await result.current.handleLoadModels();
    });

    expect(mockedGetAiAnnotationModels).toHaveBeenCalledWith({
      body: { base_url: null, api_key: null },
      headers: { Authorization: 'Bearer test-token' },
      throwOnError: true,
    });
    expect(setModel).toHaveBeenCalledWith('gpt-a');
    expect(result.current.availableModels).toEqual([
      { id: 'gpt-a', name: 'GPT A' },
      { id: 'gpt-b', name: 'GPT B' },
    ]);
    expect(setStatusMessage).toHaveBeenCalledWith('models loaded');
  });

  it('detaches annotation output with a normalized node name', async () => {
    const { result } = renderHook(() => useAiAnnotationTaskFlow(defaultArgs));

    await act(async () => {
      await result.current.handleDetach();
    });

    expect(mockedDetachAiAnnotation).toHaveBeenCalledWith({
      body: expect.objectContaining({
        column: 'text',
        new_node_name: 'Node_One_ai_annotation',
        annotation_column: null,
        model: 'gpt-test',
      }),
      headers: { Authorization: 'Bearer test-token' },
      path: { node_id: 'node-1' },
      throwOnError: true,
    });
    expect(setStatusMessage).toHaveBeenCalledWith('AI annotation detach started.');
  });

  it('reports a missing node or column before running', async () => {
    const { result } = renderHook(() =>
      useAiAnnotationTaskFlow({ ...defaultArgs, selectedNodeId: null }),
    );

    await act(async () => {
      await result.current.handleRun();
    });

    expect(mockedRunAiAnnotation).not.toHaveBeenCalled();
    expect(setStatusMessage).toHaveBeenCalledWith(
      'Select one data block and text column before running.',
    );
  });
});
