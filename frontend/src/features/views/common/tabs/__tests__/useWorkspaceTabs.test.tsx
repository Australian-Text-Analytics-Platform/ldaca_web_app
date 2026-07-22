import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listTabs: vi.fn(),
  createTab: vi.fn(),
  deleteTab: vi.fn(),
  renameTab: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  listTabs: mocks.listTabs,
  createTab: mocks.createTab,
  deleteTab: mocks.deleteTab,
  renameTab: mocks.renameTab,
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

const serverTab = (id = 'tab-1', kind: 'concordance' | 'quotation' = 'concordance') => ({
  id,
  name: id,
  kind,
  analysis_id: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  revision: 1,
});

describe('useWorkspaceTabs', () => {
  beforeEach(() => {
    mocks.listTabs.mockReset();
    mocks.createTab.mockReset();
    mocks.deleteTab.mockReset();
    mocks.renameTab.mockReset();
    mocks.listTabs.mockResolvedValue({ data: [serverTab()], error: undefined });
    mocks.createTab.mockResolvedValue({ data: serverTab('tab-2'), error: undefined });
    mocks.deleteTab.mockResolvedValue({ data: undefined, error: undefined });
    mocks.renameTab.mockResolvedValue({ data: serverTab(), error: undefined });
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
      expect(mocks.renameTab).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
          body: { name: 'Renamed' },
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
    expect(mocks.renameTab).not.toHaveBeenCalled();

    view.unmount();
    view = renderHook(() => useWorkspaceTabs('workspace-1', 'concordance'), { wrapper });
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(1));
    expect(view.result.current.tabs[0]?.input_sets.source).toEqual([]);
    expect(view.result.current.tabs[0]?.settings).toEqual({ mode: 'manual' });
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
