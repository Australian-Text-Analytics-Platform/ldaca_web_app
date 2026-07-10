import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationAiPreviewSession } from '../useAnnotationAiPreviewSession';
import { createNodeDataRequest, queryKeys } from '@/lib/queryKeys';
import { ApiError } from '@/lib/apiError';

const mocks = vi.hoisted(() => ({
  getNodeDataByWorkspaceId: vi.fn(),
  getAnnotationClassDescriptions: vi.fn(),
  annotateAiPreview: vi.fn(),
  annotateAiPreviewState: vi.fn(),
  annotateAiPreviewOverride: vi.fn(),
  annotateAiPreviewClear: vi.fn(),
  annotateAiAll: vi.fn(),
  detachAiPreviewedRows: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/api', () => ({
  getNodeDataByWorkspaceId: mocks.getNodeDataByWorkspaceId,
  getAnnotationClassDescriptions: mocks.getAnnotationClassDescriptions,
  annotateAiPreview: mocks.annotateAiPreview,
  annotateAiPreviewState: mocks.annotateAiPreviewState,
  annotateAiPreviewOverride: mocks.annotateAiPreviewOverride,
  annotateAiPreviewClear: mocks.annotateAiPreviewClear,
  annotateAiAll: mocks.annotateAiAll,
  detachAiPreviewedRows: mocks.detachAiPreviewedRows,
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/** Creates an externally controlled promise for proving async ordering. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const baseConfig = {
  workspaceId: 'workspace-1',
  nodeId: 'node-1',
  textColumn: 'text',
  annotationColumn: 'label',
  classNodeId: 'classes-1',
  classColumn: 'class',
  descriptionColumn: 'description',
  providerId: 'openrouter',
  baseUrl: null,
  apiKey: 'sk-test',
  model: 'gpt-4o',
  systemPrompt: 'Classify.',
  temperature: 0,
  reasoningEnabled: false,
  reasoningEffort: 'medium',
  targetValid: true,
};

type SessionConfig = typeof baseConfig;

/**
 * Mounts the session owner with a real QueryClient and stateful open contract.
 *
 * Used by: lifecycle tests below. The stateful wrapper mirrors
 * AnnotationFeature, so explicit close actually disables observers and reopen
 * enables a fresh generation instead of testing an impossible fixed-open hook.
 */
function renderSession(initialConfig: SessionConfig = baseConfig) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const prepareOpen = vi.fn(() => Promise.resolve(true));
  const onExplicitClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ config }: { config: SessionConfig }) => {
      const [isOpen, setIsOpen] = useState(true);
      return useAnnotationAiPreviewSession({
        ...config,
        isOpen,
        onOpenChange: setIsOpen,
        prepareOpen,
        onExplicitClose,
      });
    },
    { initialProps: { config: initialConfig }, wrapper },
  );
  return { ...view, queryClient, prepareOpen, onExplicitClose };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getNodeDataByWorkspaceId.mockResolvedValue({
    data: {
      data: [{ text: 'first' }, { text: 'second' }],
      revision: 'source-revision-1',
      pagination: { total_rows: 2 },
    },
  });
  mocks.getAnnotationClassDescriptions.mockResolvedValue({
    data: {
      rows: [
        { class: 'Positive', description: 'good' },
        { class: 'Negative', description: 'bad' },
      ],
    },
  });
  mocks.annotateAiPreviewState.mockResolvedValue({
    data: { session_id: null, annotation_column: null, rows: [] },
  });
  mocks.annotateAiPreview.mockResolvedValue({
    data: { session_id: 'session-1', labels: ['Positive', 'Negative'] },
  });
  mocks.annotateAiPreviewOverride.mockResolvedValue({ data: { ok: true } });
  mocks.annotateAiPreviewClear.mockResolvedValue({ data: { ok: true } });
  mocks.annotateAiAll.mockResolvedValue({
    data: { node: { id: 'node-1' }, labeled_rows: 2, total_rows: 2 },
  });
  mocks.detachAiPreviewedRows.mockResolvedValue({
    data: { node: null, detached_rows: 2 },
  });
});

describe('useAnnotationAiPreviewSession', () => {
  it('sends the exact target identity and abort signal through every page query', async () => {
    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.identity.id).toBe('session-1');
    });
    await waitFor(() => {
      expect(result.current.detach.count).toBe(2);
    });

    expect(mocks.annotateAiPreviewState).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ annotation_column: 'label' }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.getNodeDataByWorkspaceId).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.getAnnotationClassDescriptions).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.annotateAiPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ annotation_column: 'label' }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.detachAiPreviewedRows).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          session_id: 'session-1',
          annotation_column: 'label',
          dry_run: true,
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('isolates a superseded target and ignores its late preview completion', async () => {
    const oldPreview = deferred<{
      data: { session_id: string; labels: string[] };
    }>();
    mocks.annotateAiPreview.mockImplementation(
      (request: { body: { annotation_column: string } }) =>
        request.body.annotation_column === 'old_label'
          ? oldPreview.promise
          : Promise.resolve({
              data: { session_id: 'new-session', labels: ['New', 'New'] },
            }),
    );
    const { result, rerender } = renderSession({
      ...baseConfig,
      annotationColumn: 'old_label',
    });

    await waitFor(() => {
      expect(mocks.annotateAiPreview).toHaveBeenCalledTimes(1);
    });
    const oldSignal = (mocks.annotateAiPreview.mock.calls[0]?.[0] as { signal: AbortSignal })
      .signal;
    rerender({ config: { ...baseConfig, annotationColumn: 'new_label' } });

    await waitFor(() => {
      expect(result.current.identity.id).toBe('new-session');
    });
    expect(result.current.predictions.labels).toEqual(['New', 'New']);
    expect(oldSignal.aborted).toBe(true);

    oldPreview.resolve({
      data: { session_id: 'old-session', labels: ['Old', 'Old'] },
    });
    await act(async () => {
      await oldPreview.promise;
    });
    expect(result.current.identity.id).toBe('new-session');
    expect(result.current.predictions.labels).toEqual(['New', 'New']);
  });

  it('starts a fresh generation when class descriptions change without changing class names', async () => {
    mocks.annotateAiPreview
      .mockResolvedValueOnce({
        data: { session_id: 'old-session', labels: ['Positive', 'Negative'] },
      })
      .mockResolvedValueOnce({
        data: { session_id: 'new-session', labels: ['Negative', 'Positive'] },
      });
    const { result, queryClient } = renderSession();
    await waitFor(() => {
      expect(result.current.identity.id).toBe('old-session');
    });

    act(() => {
      queryClient.setQueryData(
        queryKeys.annotationClassDescriptions('workspace-1', 'classes-1', 'class', 'description'),
        {
          rows: [
            { class: 'Positive', description: 'affirming or supportive' },
            { class: 'Negative', description: 'critical or opposed' },
          ],
        },
      );
    });

    await waitFor(() => {
      expect(result.current.identity.id).toBe('new-session');
    });
    expect(mocks.annotateAiPreview).toHaveBeenCalledTimes(2);
    expect(result.current.predictions.labels).toEqual(['Negative', 'Positive']);
  });

  it('does not change prediction identity for blank or duplicate class rows the backend ignores', async () => {
    const { result, queryClient } = renderSession();
    await waitFor(() => {
      expect(result.current.identity.id).toBe('session-1');
    });

    act(() => {
      queryClient.setQueryData(
        queryKeys.annotationClassDescriptions('workspace-1', 'classes-1', 'class', 'description'),
        {
          rows: [
            { class: 'Positive', description: 'good' },
            { class: 'Negative', description: 'bad' },
            { class: '  ', description: 'ignored blank' },
            { class: 'Positive', description: 'ignored duplicate' },
          ],
        },
      );
    });

    await waitFor(() => {
      expect(result.current.classes.options).toEqual(['Positive', 'Negative']);
    });
    expect(mocks.annotateAiPreview).toHaveBeenCalledTimes(1);
    expect(result.current.identity.id).toBe('session-1');
  });

  it('rechecks the backend generation after the source-node query updates', async () => {
    mocks.annotateAiPreview
      .mockResolvedValueOnce({
        data: { session_id: 'old-session', labels: ['Positive', 'Negative'] },
      })
      .mockResolvedValueOnce({
        data: { session_id: 'new-session', labels: ['Negative', 'Positive'] },
      });
    const { result, queryClient } = renderSession();
    await waitFor(() => {
      expect(result.current.identity.id).toBe('old-session');
    });

    act(() => {
      queryClient.setQueryData(
        queryKeys.nodeData(
          'workspace-1',
          'node-1',
          createNodeDataRequest({ page: 1, page_size: 20 }),
        ),
        {
          data: [{ text: 'changed' }, { text: 'second' }],
          revision: 'source-revision-2',
          pagination: { total_rows: 2 },
        },
      );
    });

    await waitFor(() => {
      expect(result.current.identity.id).toBe('new-session');
    });
    expect(mocks.annotateAiPreviewState).toHaveBeenCalledTimes(2);
    expect(mocks.annotateAiPreview).toHaveBeenCalledTimes(2);
  });

  it('keeps hydrated overrides authoritative when the page preview settles later', async () => {
    const preview = deferred<{ data: { session_id: string; labels: string[] } }>();
    mocks.annotateAiPreview.mockReturnValue(preview.promise);
    mocks.annotateAiPreviewState.mockResolvedValue({
      data: {
        session_id: 'hydrated-session',
        annotation_column: 'label',
        rows: [
          {
            row_index: 0,
            ai: 'Positive',
            override: 'Negative',
            has_override: true,
            effective: 'Negative',
          },
        ],
      },
    });
    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.identity.id).toBe('hydrated-session');
    });
    expect(result.current.identity.origin).toBe('hydrated');
    expect(result.current.predictions.getSelection(0, undefined)).toBe('Negative');
    await waitFor(() => {
      expect(mocks.annotateAiPreview).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      preview.resolve({
        data: { session_id: 'hydrated-session', labels: ['Positive', 'Positive'] },
      });
      await preview.promise;
    });
    await waitFor(() => {
      expect(result.current.predictions.query.isSuccess).toBe(true);
    });
    expect(result.current.predictions.getSelection(0, 'Positive')).toBe('Negative');
  });

  it('serializes rapid row edits and does not roll back a newer edit when the older one fails', async () => {
    const first = deferred<{ data: { ok: boolean } }>();
    const second = deferred<{ data: { ok: boolean } }>();
    mocks.annotateAiPreviewOverride
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderSession();
    await waitFor(() => {
      expect(result.current.identity.id).toBe('session-1');
    });

    act(() => {
      result.current.predictions.setSelection(0, 'Negative');
      result.current.predictions.setSelection(0, 'Positive');
    });
    expect(result.current.predictions.getSelection(0, 'Positive')).toBe('Positive');
    await waitFor(() => {
      expect(mocks.annotateAiPreviewOverride).toHaveBeenCalledTimes(1);
    });

    first.reject(new Error('old edit failed'));
    await waitFor(() => {
      expect(mocks.annotateAiPreviewOverride).toHaveBeenCalledTimes(2);
    });
    expect(result.current.predictions.getSelection(0, 'Positive')).toBe('Positive');
    expect(mocks.toastError).not.toHaveBeenCalled();

    second.resolve({ data: { ok: true } });
    await waitFor(() => {
      expect(result.current.isBusy).toBe(false);
    });
    expect(mocks.annotateAiPreviewOverride.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        body: { session_id: 'session-1', label: 'Positive' },
      }),
    );
  });

  it('rolls the latest failed edit back to the last confirmed label', async () => {
    mocks.annotateAiPreviewOverride.mockRejectedValue(new Error('save failed'));
    const { result } = renderSession();
    await waitFor(() => {
      expect(result.current.identity.id).toBe('session-1');
    });

    act(() => {
      result.current.predictions.setSelection(0, 'Negative');
    });
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('save failed');
    });

    expect(result.current.predictions.getSelection(0, 'Positive')).toBe('Positive');
  });

  it('waits for explicit clear before reopening a fresh generation', async () => {
    const clear = deferred<{ data: { ok: boolean } }>();
    mocks.annotateAiPreviewClear.mockReturnValueOnce(clear.promise);
    mocks.annotateAiPreview
      .mockResolvedValueOnce({
        data: { session_id: 'old-session', labels: ['Positive', 'Negative'] },
      })
      .mockResolvedValueOnce({
        data: { session_id: 'new-session', labels: ['Negative', 'Positive'] },
      });
    const { result, prepareOpen, queryClient } = renderSession();
    await waitFor(() => {
      expect(result.current.identity.id).toBe('old-session');
    });

    let closing!: Promise<void>;
    let reopening!: Promise<void>;
    act(() => {
      closing = result.current.commands.close();
      reopening = result.current.commands.open();
    });
    await waitFor(() => {
      expect(mocks.annotateAiPreviewClear).toHaveBeenCalledTimes(1);
    });
    expect(mocks.annotateAiPreviewClear).toHaveBeenCalledWith(
      expect.objectContaining({ query: { session_id: 'old-session' } }),
    );
    expect(prepareOpen).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryCache().findAll({
        queryKey: ['annotation', 'ai-preview', 'workspace-1', 'node-1'],
      }),
    ).toEqual([]);

    clear.resolve({ data: { ok: true } });
    await act(async () => {
      await Promise.all([closing, reopening]);
    });
    await waitFor(() => {
      expect(result.current.identity.id).toBe('new-session');
    });
    expect(prepareOpen).toHaveBeenCalledTimes(1);
  });

  it('clears a generation created by a preview that finishes after Close is clicked', async () => {
    const preview = deferred<{ data: { session_id: string; labels: string[] } }>();
    mocks.annotateAiPreview.mockReturnValue(preview.promise);
    const { result } = renderSession();
    await waitFor(() => {
      expect(result.current.predictions.query.isFetching).toBe(true);
    });

    let closing!: Promise<void>;
    act(() => {
      closing = result.current.commands.close();
    });
    expect(mocks.annotateAiPreviewClear).not.toHaveBeenCalled();

    preview.resolve({
      data: { session_id: 'late-session', labels: ['Positive', 'Negative'] },
    });
    await act(async () => {
      await closing;
    });
    expect(mocks.annotateAiPreviewClear).toHaveBeenCalledWith(
      expect.objectContaining({ query: { session_id: 'late-session' } }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it('preserves the backend generation when the tab owner merely unmounts', async () => {
    const { result, unmount } = renderSession();
    await waitFor(() => {
      expect(result.current.identity.id).toBe('session-1');
    });

    unmount();

    expect(mocks.annotateAiPreviewClear).not.toHaveBeenCalled();
  });

  it('hydrates and explicitly clears an invalid persisted target without previewing it', async () => {
    mocks.annotateAiPreviewState.mockResolvedValue({
      data: {
        session_id: 'invalid-target-session',
        annotation_column: 'deleted_label',
        rows: [],
      },
    });
    const { result } = renderSession({
      ...baseConfig,
      annotationColumn: 'deleted_label',
      targetValid: false,
    });
    await waitFor(() => {
      expect(result.current.identity.id).toBe('invalid-target-session');
    });
    expect(mocks.annotateAiPreview).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.commands.close();
    });
    expect(mocks.annotateAiPreviewClear).toHaveBeenCalledWith(
      expect.objectContaining({ query: { session_id: 'invalid-target-session' } }),
    );
  });

  it('retries a failed old-session clear before allowing reopen', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.annotateAiPreviewClear
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: { ok: true } });
    const { result, prepareOpen } = renderSession();
    await waitFor(() => {
      expect(result.current.identity.id).toBe('session-1');
    });

    await act(async () => {
      await result.current.commands.close();
    });
    expect(mocks.annotateAiPreviewClear).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.commands.open();
    });
    expect(mocks.annotateAiPreviewClear).toHaveBeenCalledTimes(2);
    expect(prepareOpen).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('retains a busy generation and clears it after materialization releases', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.annotateAiPreviewClear
      .mockRejectedValueOnce(
        new ApiError('Annotation preview session is being materialised', {
          status: 409,
          code: 'annotation_preview_session_busy',
        }),
      )
      .mockResolvedValueOnce({ data: { ok: true } });
    const { result, prepareOpen } = renderSession();
    await waitFor(() => {
      expect(result.current.identity.id).toBe('session-1');
    });

    await act(async () => {
      await result.current.commands.close();
    });
    await act(async () => {
      await result.current.commands.open();
    });

    expect(mocks.annotateAiPreviewClear).toHaveBeenCalledTimes(2);
    expect(prepareOpen).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('freezes edits and pagination while annotate-all owns materialization', async () => {
    const annotateAll = deferred<{
      data: { node: { id: string }; labeled_rows: number; total_rows: number };
    }>();
    mocks.annotateAiAll.mockReturnValue(annotateAll.promise);
    const { result, onExplicitClose } = renderSession();
    await waitFor(() => {
      expect(result.current.annotateAll.canRun).toBe(true);
    });

    act(() => {
      result.current.annotateAll.run();
    });
    await waitFor(() => {
      expect(result.current.isMaterializing).toBe(true);
    });
    act(() => {
      result.current.predictions.setSelection(0, 'Negative');
      result.current.page.setPagination({ pageIndex: 1, pageSize: 20 });
    });
    expect(mocks.annotateAiPreviewOverride).not.toHaveBeenCalled();
    expect(result.current.page.pagination.pageIndex).toBe(0);
    expect(mocks.annotateAiAll).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ session_id: 'session-1' }),
      }),
    );

    annotateAll.resolve({
      data: { node: { id: 'node-1' }, labeled_rows: 2, total_rows: 2 },
    });
    await waitFor(() => {
      expect(onExplicitClose).toHaveBeenCalledTimes(1);
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.identity.id).toBeNull();
  });
});
