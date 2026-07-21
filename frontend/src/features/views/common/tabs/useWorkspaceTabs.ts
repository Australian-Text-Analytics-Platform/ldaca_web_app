/** Manage durable Workspace Tabs plus frontend-owned tab presentation state. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTab as createServerTab,
  deleteTab as deleteServerTab,
  listTabs,
  renameTab as renameServerTab,
} from '@/api';
import type { AnalysisKind, Tab } from '@/api';
import {
  DEFAULT_TAB_INPUT_SET_ID,
  reorderTabs,
  tabFromResource,
  type AnalysisTab,
  type AnalysisTabInput,
  type AnalysisTabInputSets,
} from './tabStateOps';
import {
  analysisTabsPresentationKey,
  useAnalysisTabsPresentationStore,
} from './analysisTabsPresentationStore';

const tabsQueryKey = (workspaceId: string | null | undefined, kind: string) => [
  'workspace-tabs',
  workspaceId ?? '__none__',
  kind,
];

export interface UseWorkspaceTabsResult {
  tabs: AnalysisTab[];
  activeTabId: string | null;
  isLoading: boolean;
  createTab: (title?: string) => Promise<Tab | null>;
  closeTab: (tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
  setActiveTab: (tabId: string) => void;
  reorderTabs: (orderedTabIds: string[]) => void;
  setTabTask: (tabId: string, analysisId: string | null) => void;
  setTabInputSet: (tabId: string, selectorId: string, inputs: AnalysisTabInput[]) => void;
  setTabSetting: (tabId: string, key: string, value: string) => void;
}

interface LocalTabState {
  task_id?: string | null;
  input_sets?: AnalysisTabInputSets;
  settings?: Record<string, string>;
}

function inputSetsEqual(left: AnalysisTabInput[], right: AnalysisTabInput[]): boolean {
  return (
    left.length === right.length &&
    left.every((input, index) => {
      const other = right.at(index);
      return other?.node_id === input.node_id && other.column === input.column;
    })
  );
}

const asAnalysisKind = (value: string): AnalysisKind => {
  if (
    value === 'annotation' ||
    value === 'concordance' ||
    value === 'quotation' ||
    value === 'sequential' ||
    value === 'token_frequency' ||
    value === 'topic_modeling'
  ) {
    return value;
  }
  throw new Error(`Unsupported analysis tab kind: ${value}`);
};

function mergeServerTabs(serverTabs: Tab[], local: Record<string, LocalTabState>): AnalysisTab[] {
  return serverTabs.map((tab) => tabFromResource(tab, local[tab.id]));
}

/**
 * Server tabs are authoritative for identity, names, and analysis ownership.
 * Active selection is device-local and keyed by Workspace and analysis kind.
 * Ordering, input selections, and settings stay in memory so drafts do not
 * become a second persistence format.
 */
export function useWorkspaceTabs(
  workspaceId: string | null | undefined,
  analysisType: string,
): UseWorkspaceTabsResult {
  const queryClient = useQueryClient();
  const kind = asAnalysisKind(analysisType);
  const queryKey = tabsQueryKey(workspaceId, kind);
  const presentationKey = analysisTabsPresentationKey(workspaceId, kind);
  const activeTabId = useAnalysisTabsPresentationStore(
    (state) => state.activeTabIds[presentationKey] ?? null,
  );
  const rememberActiveTab = useAnalysisTabsPresentationStore((state) => state.rememberActiveTab);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [localState, setLocalState] = useState<Record<string, LocalTabState>>({});
  const creatingRef = useRef(false);

  const tabsQuery = useQuery({
    queryKey,
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    queryFn: async () => {
      if (!workspaceId) throw new Error('Workspace is required');
      const { data } = await listTabs({
        path: { workspace_id: workspaceId },
        throwOnError: true,
      });
      return data.filter((tab) => tab.kind === kind);
    },
  });

  const serverTabs = tabsQuery.data ?? [];
  const mergedTabs = mergeServerTabs(serverTabs, localState);
  const orderedTabs = orderedIds.length > 0 ? reorderTabs(mergedTabs, orderedIds) : mergedTabs;
  const resolvedActiveId =
    activeTabId && orderedTabs.some((tab) => tab.tab_id === activeTabId)
      ? activeTabId
      : (orderedTabs[0]?.tab_id ?? null);

  /* eslint-disable react-hooks/set-state-in-effect -- Reset ephemeral tab drafts when the selected workspace changes. */
  useEffect(() => {
    if (!workspaceId) {
      setOrderedIds([]);
      setLocalState({});
      return;
    }
    setOrderedIds((current) =>
      current.length > 0
        ? current.filter((id) => orderedTabs.some((tab) => tab.tab_id === id))
        : [],
    );
    // The server tab count is the external change that invalidates local ordering;
    // names and analysis state are already represented by the merged query data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, serverTabs.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!workspaceId || tabsQuery.isLoading || activeTabId === resolvedActiveId) return;
    rememberActiveTab(workspaceId, kind, resolvedActiveId);
  }, [activeTabId, kind, rememberActiveTab, resolvedActiveId, tabsQuery.isLoading, workspaceId]);

  const setLocalTab = useCallback(
    (tabId: string, update: (previous: LocalTabState) => LocalTabState) => {
      setLocalState((current) => {
        const previous = current[tabId] ?? {};
        const next = update(previous);
        return next === previous ? current : { ...current, [tabId]: next };
      });
    },
    [],
  );

  const invalidate = useCallback(() => {
    if (workspaceId) void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey, workspaceId]);

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!workspaceId) return null;
      const { data } = await createServerTab({
        path: { workspace_id: workspaceId },
        body: { kind, name },
        throwOnError: true,
      });
      return data;
    },
    onSuccess: (tab) => {
      creatingRef.current = false;
      if (tab) {
        rememberActiveTab(workspaceId, kind, tab.id);
        setOrderedIds((current) => [...current.filter((id) => id !== tab.id), tab.id]);
      }
      invalidate();
    },
    onError: () => {
      creatingRef.current = false;
    },
  });

  const createTab = useCallback(
    async (title = `Analysis ${String(serverTabs.length + 1)}`): Promise<Tab | null> => {
      if (!workspaceId || createMutation.isPending || creatingRef.current) return null;
      creatingRef.current = true;
      return await createMutation.mutateAsync(title);
    },
    [createMutation, serverTabs.length, workspaceId],
  );

  const closeMutation = useMutation({
    mutationFn: async (tabId: string) => {
      if (!workspaceId) return;
      await deleteServerTab({
        path: { workspace_id: workspaceId, tab_id: tabId },
        throwOnError: true,
      });
    },
    onSuccess: (_value, tabId) => {
      setLocalState((current) => {
        const { [tabId]: _removed, ...remaining } = current;
        return remaining;
      });
      setOrderedIds((current) => current.filter((id) => id !== tabId));
      const currentActive =
        useAnalysisTabsPresentationStore.getState().activeTabIds[presentationKey] ?? null;
      if (currentActive === tabId) {
        const fallbackTabId = orderedTabs.find((tab) => tab.tab_id !== tabId)?.tab_id ?? null;
        rememberActiveTab(workspaceId, kind, fallbackTabId);
      }
      invalidate();
    },
  });

  const closeTab = useCallback(
    (tabId: string) => {
      if (workspaceId) closeMutation.mutate(tabId);
    },
    [closeMutation, workspaceId],
  );

  const renameMutation = useMutation({
    mutationFn: async ({ tabId, title }: { tabId: string; title: string }) => {
      if (!workspaceId) return;
      await renameServerTab({
        path: { workspace_id: workspaceId, tab_id: tabId },
        body: { name: title },
        throwOnError: true,
      });
    },
    onSuccess: invalidate,
  });

  const renameTab = useCallback(
    (tabId: string, title: string) => {
      if (workspaceId) renameMutation.mutate({ tabId, title });
    },
    [renameMutation, workspaceId],
  );

  const setActiveTab = useCallback((tabId: string) => {
    rememberActiveTab(workspaceId, kind, tabId);
  }, [kind, rememberActiveTab, workspaceId]);

  const reorder = useCallback((ids: string[]) => {
    setOrderedIds(ids);
  }, []);

  const setTabTask = useCallback(
    (tabId: string, analysisId: string | null) => {
      setLocalTab(tabId, (previous) => ({ ...previous, task_id: analysisId }));
      invalidate();
    },
    [invalidate, setLocalTab],
  );

  const setTabInputSet = useCallback(
    (tabId: string, selectorId: string, inputs: AnalysisTabInput[]) => {
      setLocalTab(tabId, (previous) => {
        const previousInputs = previous.input_sets?.[selectorId] ?? [];
        if (inputSetsEqual(previousInputs, inputs)) return previous;
        return {
          ...previous,
          input_sets: {
            ...(previous.input_sets ?? { [DEFAULT_TAB_INPUT_SET_ID]: [] }),
            [selectorId]: inputs,
          },
        };
      });
    },
    [setLocalTab],
  );

  const setTabSetting = useCallback(
    (tabId: string, key: string, value: string) => {
      setLocalTab(tabId, (previous) => ({
        ...previous,
        settings: { ...(previous.settings ?? {}), [key]: value },
      }));
    },
    [setLocalTab],
  );

  return {
    tabs: orderedTabs,
    activeTabId: resolvedActiveId,
    isLoading: Boolean(workspaceId) && tabsQuery.isLoading,
    createTab,
    closeTab,
    renameTab,
    setActiveTab,
    reorderTabs: reorder,
    setTabTask,
    setTabInputSet,
    setTabSetting,
  };
}
