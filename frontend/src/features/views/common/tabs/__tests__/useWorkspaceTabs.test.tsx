import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisKind, Tab, TabSettings } from '@/api';

const mocks = vi.hoisted(() => ({
  listTabs: vi.fn(),
  createTab: vi.fn(),
  deleteTab: vi.fn(),
  updateTab: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  listTabs: mocks.listTabs,
  createTab: mocks.createTab,
  deleteTab: mocks.deleteTab,
  updateTab: mocks.updateTab,
}));

import { useWorkspaceTabs } from '../useWorkspaceTabs';
import {
  analysisTabsPresentationKey,
  useAnalysisTabsPresentationStore,
} from '../analysisTabsPresentationStore';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const serverTab = (id = 'tab-1', kind: AnalysisKind = 'concordance'): Tab => {
  const settings: TabSettings =
    kind === 'annotation'
      ? { kind, correction_columns: {} }
      : kind === 'token_frequency'
        ? { kind, stop_words: { words: [] } }
        : kind === 'topic_modeling'
          ? {
              kind,
              stop_words: { words: [] },
              words_per_topic: 15,
              projection_selection: null,
            }
          : { kind };
  return {
    availability: 'available',
    id,
    name: id,
    kind,
    analysis_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    modified_at: '2026-01-01T00:00:00Z',
    revision: 1,
    settings,
  };
};

describe('useWorkspaceTabs', () => {
  beforeEach(() => {
    mocks.listTabs.mockReset();
    mocks.createTab.mockReset();
    mocks.deleteTab.mockReset();
    mocks.updateTab.mockReset();
    mocks.listTabs.mockResolvedValue({ data: [serverTab()], error: undefined });
    mocks.createTab.mockResolvedValue({ data: serverTab('tab-2'), error: undefined });
    mocks.deleteTab.mockResolvedValue({ data: undefined, error: undefined });
    mocks.updateTab.mockResolvedValue({ data: serverTab(), error: undefined });
    useAnalysisTabsPresentationStore.setState({ activeTabIds: {}, tabSettings: {} });
    localStorage.removeItem('ldaca-analysis-tab-presentation-v2');
  });

  it('loads server-owned tabs and keeps active selection device-local', async () => {
    const { result } = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    expect(result.current.tabs[0]).toMatchObject({ tab_id: 'tab-1', kind: 'concordance' });
    act(() => result.current.setActiveTab('tab-1'));
    expect(result.current.activeTabId).toBe('tab-1');
  });

  it('restores the active tab after the view hook unmounts and remounts', async () => {
    mocks.listTabs.mockResolvedValue({
      data: [serverTab('tab-1'), serverTab('tab-2')],
      error: undefined,
    });
    let view = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), {
      wrapper,
    });
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(2));

    act(() => {
      view.result.current.setActiveTab('tab-2');
    });
    expect(view.result.current.activeTabId).toBe('tab-2');
    view.unmount();

    view = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), {
      wrapper,
    });
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(2));

    expect(view.result.current.activeTabId).toBe('tab-2');
    expect(
      useAnalysisTabsPresentationStore.getState().activeTabIds[
        analysisTabsPresentationKey('__anonymous__', 'workspace-1', 'concordance')
      ],
    ).toBe('tab-2');
  });

  it('repairs a stored tab id that no longer exists', async () => {
    useAnalysisTabsPresentationStore
      .getState()
      .rememberActiveTab('__anonymous__', 'workspace-1', 'concordance', 'missing-tab');

    const { result } = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.activeTabId).toBe('tab-1');
      expect(
        useAnalysisTabsPresentationStore.getState().activeTabIds[
          analysisTabsPresentationKey('__anonymous__', 'workspace-1', 'concordance')
        ],
      ).toBe('tab-1');
    });
  });

  it('selects and remembers a fallback when the active tab is deleted', async () => {
    mocks.listTabs.mockResolvedValue({
      data: [serverTab('tab-1'), serverTab('tab-2')],
      error: undefined,
    });
    const { result } = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
    act(() => result.current.setActiveTab('tab-2'));

    act(() => result.current.closeTab('tab-2'));

    await waitFor(() => {
      expect(result.current.activeTabId).toBe('tab-1');
      expect(
        useAnalysisTabsPresentationStore.getState().activeTabIds[
          analysisTabsPresentationKey('__anonymous__', 'workspace-1', 'concordance')
        ],
      ).toBe('tab-1');
    });
  });

  it('appends and opens a newly created tab when the server returns newest tabs first', async () => {
    mocks.createTab.mockImplementation(async () => {
      mocks.listTabs.mockResolvedValue({
        data: [serverTab('tab-2'), serverTab('tab-1')],
        error: undefined,
      });
      return { data: serverTab('tab-2'), error: undefined };
    });
    const { result } = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));

    await act(async () => {
      await result.current.createTab('Second');
    });

    await waitFor(() => {
      expect(result.current.tabs.map((tab) => tab.tab_id)).toEqual(['tab-1', 'tab-2']);
      expect(result.current.activeTabId).toBe('tab-2');
    });
  });

  it('creates, renames, and deletes durable tabs through canonical endpoints', async () => {
    const { result } = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    let createdTab = null;
    await act(async () => {
      createdTab = await result.current.createTab('Second');
    });
    expect(createdTab).toMatchObject({ id: 'tab-2' });
    await waitFor(() =>
      expect(mocks.createTab).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { workspace_id: 'workspace-1' },
          body: { kind: 'concordance', name: 'Second' },
        }),
      ),
    );
    act(() => result.current.renameTab('tab-1', 'Renamed'));
    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
          body: { kind: 'concordance', name: 'Renamed' },
        }),
      ),
    );
    act(() => result.current.closeTab('tab-1'));
    await waitFor(() =>
      expect(mocks.deleteTab).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
        }),
      ),
    );
  });

  it('keeps drafts in memory and restores presentation settings from device-local storage', async () => {
    let view = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), {
      wrapper,
    });
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(1));
    act(() => {
      view.result.current.setTabInputSet('tab-1', 'source', [
        { node_id: 'node-1', column: 'text' },
      ]);
      view.result.current.setTabSetting('tab-1', 'mode', 'manual');
    });
    expect(view.result.current.tabs[0]?.input_sets.source).toEqual([
      { node_id: 'node-1', column: 'text' },
    ]);
    expect(view.result.current.tabs[0]?.settings).toEqual({ mode: 'manual' });
    expect(mocks.updateTab).not.toHaveBeenCalled();

    view.unmount();
    view = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), { wrapper });
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(1));
    expect(view.result.current.tabs[0]?.input_sets.source).toEqual([]);
    expect(view.result.current.tabs[0]?.settings).toEqual({ mode: 'manual' });
  });

  it('persists and clears Annotation correction-column drafts on the Tab resource', async () => {
    mocks.listTabs.mockResolvedValue({ data: [serverTab('tab-1', 'annotation')] });
    mocks.updateTab.mockImplementation(({ body }) =>
      Promise.resolve({
        data: {
          ...serverTab('tab-1', 'annotation'),
          settings: {
            kind: 'annotation',
            correction_columns: body.correction_columns ?? {},
          },
        },
      }),
    );
    const { result } = renderHook(() => useWorkspaceTabs('workspace-1', 'annotation'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));

    act(() => {
      result.current.setAnnotationCorrectionColumn('tab-1', 'node-1', 'review');
    });
    await waitFor(() => {
      expect(mocks.updateTab).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { kind: 'annotation', correction_columns: { 'node-1': 'review' } },
        }),
      );
    });

    act(() => {
      result.current.clearAnnotationCorrectionColumns('tab-1');
    });
    await waitFor(() => {
      expect(mocks.updateTab).toHaveBeenLastCalledWith(
        expect.objectContaining({ body: { kind: 'annotation', correction_columns: {} } }),
      );
    });
  });

  it('rolls back an Annotation correction-column draft when persistence fails', async () => {
    mocks.listTabs.mockResolvedValue({ data: [serverTab('tab-1', 'annotation')] });
    mocks.updateTab.mockRejectedValue(new Error('save failed'));
    const { result } = renderHook(() => useWorkspaceTabs('workspace-1', 'annotation'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));

    await act(async () => {
      await expect(
        result.current.setAnnotationCorrectionColumn('tab-1', 'node-1', 'review'),
      ).rejects.toThrow('save failed');
    });

    expect(result.current.tabs[0]?.correctionColumns).toEqual({});
  });

  it('optimistically patches and rolls back backend-owned presentation settings', async () => {
    mocks.listTabs.mockResolvedValue({ data: [serverTab('tab-1', 'topic_modeling')] });
    mocks.updateTab.mockRejectedValue(new Error('save failed'));
    const { result } = renderHook(() => useWorkspaceTabs('workspace-1', 'topic_modeling'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));

    await act(async () => {
      await expect(
        result.current.setPresentationSettings('tab-1', {
          stopWords: ['the'],
          wordsPerTopic: 25,
        }),
      ).rejects.toThrow('save failed');
    });

    expect(result.current.tabs[0]?.stopWords).toEqual([]);
    expect(result.current.tabs[0]?.wordsPerTopic).toBe(15);
  });

  it('shares one all-tabs request between analysis kinds', async () => {
    mocks.listTabs.mockResolvedValue({
      data: [serverTab('tab-c', 'concordance'), serverTab('tab-q', 'quotation')],
      error: undefined,
    });
    const { result } = renderHook(
      () => ({
        concordance: useWorkspaceTabs('workspace-1', 'concordance'),
        quotation: useWorkspaceTabs('workspace-1', 'quotation'),
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.concordance.tabs).toHaveLength(1);
      expect(result.current.quotation.tabs).toHaveLength(1);
    });
    expect(mocks.listTabs).toHaveBeenCalledTimes(1);
  });

  it('does not rerender tab state for an identical input write', async () => {
    const { result } = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));

    act(() => {
      result.current.setTabInputSet('tab-1', 'source', [{ node_id: 'node-1', column: 'text' }]);
    });
    const tabAfterFirstWrite = result.current.tabs[0];

    act(() => {
      result.current.setTabInputSet('tab-1', 'source', [{ node_id: 'node-1', column: 'text' }]);
    });

    expect(result.current.tabs[0]).toBe(tabAfterFirstWrite);
  });
});
