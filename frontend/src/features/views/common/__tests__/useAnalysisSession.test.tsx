import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Analysis } from '@/api';
import { analysisSessionKeys, useAnalysisSession } from '../hooks/useAnalysisSession';

const { getAnalysisOutputResourceMock, getAnalysisResourceMock } = vi.hoisted(() => ({
  getAnalysisOutputResourceMock: vi.fn(),
  getAnalysisResourceMock: vi.fn(),
}));

vi.mock('../analysisApi', () => ({
  getAnalysisOutputResource: getAnalysisOutputResourceMock,
  getAnalysisResource: getAnalysisResourceMock,
}));

const analysis = {
  id: 'analysis-1',
  state: 'succeeded',
  request: { kind: 'quotation', node_id: 'node-1', column: 'text' },
  error: null,
} as unknown as Analysis;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useAnalysisSession', () => {
  beforeEach(() => {
    getAnalysisResourceMock.mockReset();
    getAnalysisOutputResourceMock.mockReset();
    getAnalysisResourceMock.mockResolvedValue(analysis);
    getAnalysisOutputResourceMock.mockResolvedValue({ kind: 'quotation', data: [] });
  });

  it('loads the Result only after the owned Analysis succeeds', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () =>
        useAnalysisSession({
          workspaceId: 'workspace-1',
          analysisId: 'analysis-1',
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.analysis).toEqual(analysis));
    await waitFor(() => expect(result.current.result).toEqual({ kind: 'quotation', data: [] }));
    expect(getAnalysisOutputResourceMock).toHaveBeenCalledTimes(1);
  });

  it('retains server resources in the query cache when a tab panel unmounts', async () => {
    const { queryClient, wrapper } = setup();
    const view = renderHook(
      () =>
        useAnalysisSession({
          workspaceId: 'workspace-1',
          analysisId: 'analysis-1',
        }),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.result).not.toBeNull());

    view.unmount();

    expect(
      queryClient.getQueryData(analysisSessionKeys.analysis('workspace-1', 'analysis-1')),
    ).toEqual(analysis);
    expect(
      queryClient.getQueryData(analysisSessionKeys.results('workspace-1', 'analysis-1')),
    ).toEqual({ kind: 'quotation', data: [] });
  });
});
