import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useSelectionStore } from '../../stores/selectionStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { ConcordanceAnalysisRequest, ConcordanceAnalysisResponse, textApi } from '../../api/text';
import { queryKeys } from '../../lib/queryKeys';

interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

interface ConcordanceSettings {
  searchWord: string;
  numLeftTokens: number;
  numRightTokens: number;
  regex: boolean;
  caseSensitive: boolean;
}

export const useConcordanceTab = () => {
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  
  // Zustand store state
  const { selectedNodeIds } = useSelectionStore();
  const { currentWorkspaceId } = useWorkspaceStore();
  
  // Local component state
  const [nodeColumnSelections, setNodeColumnSelections] = useState<NodeColumnSelection[]>([]);
  const [settings, setSettings] = useState<ConcordanceSettings>({
    searchWord: '',
    numLeftTokens: 10,
    numRightTokens: 10,
    regex: false,
    caseSensitive: false,
  });
  const [showMetadata, setShowMetadata] = useState(false);
  const [nodeColors, setNodeColors] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<'separated' | 'combined'>('separated');
  const [combinedPage, setCombinedPage] = useState(1);
  const [combinedPageSize] = useState(20);

  // Memoize auth headers
  const authHeaders = useMemo(() => getAuthHeaders(), [getAuthHeaders]);

  // Default color palette
  const defaultPalette = useMemo(() => [
    '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#d97706', '#0d9488', 
    '#db2777', '#4f46e5', '#65a30d', '#0891b2', '#92400e', '#6b7280'
  ], []);

  // Concordance search query
  const concordanceQuery = useQuery({
    queryKey: queryKeys.concordance(
      currentWorkspaceId!,
      selectedNodeIds,
      settings.searchWord,
      settings.numLeftTokens,
      settings.numRightTokens,
      settings.regex,
      settings.caseSensitive,
      viewMode === 'combined'
    ),
    queryFn: async () => {
      if (!currentWorkspaceId || selectedNodeIds.length === 0 || !settings.searchWord.trim()) {
        return null;
      }

      const request: ConcordanceAnalysisRequest = {
        node_ids: selectedNodeIds,
        node_columns: Object.fromEntries(
          nodeColumnSelections.map(sel => [sel.nodeId, sel.column])
        ),
        search_word: settings.searchWord,
        num_left_tokens: settings.numLeftTokens,
        num_right_tokens: settings.numRightTokens,
        regex: settings.regex,
        case_sensitive: settings.caseSensitive,
        combined: viewMode === 'combined',
        ...(viewMode === 'combined' && {
          page: combinedPage,
          page_size: combinedPageSize,
        }),
      };

      return textApi.concordance(currentWorkspaceId, request, authHeaders);
    },
    enabled: !!(currentWorkspaceId && selectedNodeIds.length > 0 && settings.searchWord.trim()),
    staleTime: 30 * 1000, // 30 seconds
    retry: false,
  });

  // Detach concordance mutation
  const detachConcordanceMutation = useMutation({
    mutationFn: async (params: { nodeId: string; column: string; newNodeName?: string }) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      
      return textApi.concordanceDetach(
        currentWorkspaceId,
        params.nodeId,
        {
          node_id: params.nodeId,
          column: params.column,
          search_word: settings.searchWord,
          num_left_tokens: settings.numLeftTokens,
          num_right_tokens: settings.numRightTokens,
          regex: settings.regex,
          case_sensitive: settings.caseSensitive,
          new_node_name: params.newNodeName,
        },
        authHeaders
      );
    },
    onSuccess: () => {
      // Invalidate workspace graph to show new node
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.workspaceGraph(currentWorkspaceId!) 
      });
    },
  });

  // Helper functions
  const updateSetting = useCallback(<K extends keyof ConcordanceSettings>(
    key: K,
    value: ConcordanceSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const executeSearch = useCallback(() => {
    if (!settings.searchWord.trim()) return;
    
    // Reset pagination when starting new search
    setCombinedPage(1);
    
    // Refetch the query
    concordanceQuery.refetch();
  }, [settings.searchWord, concordanceQuery]);

  const resetSearch = useCallback(() => {
    setSettings({
      searchWord: '',
      numLeftTokens: 10,
      numRightTokens: 10,
      regex: false,
      caseSensitive: false,
    });
    setCombinedPage(1);
  }, []);

  // Source color mapping for combined view
  const sourceColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    // This would need the actual selectedNodes data, which should come from workspace store
    return map;
  }, [nodeColors]);

  return {
    // State
    nodeColumnSelections,
    setNodeColumnSelections,
    settings,
    updateSetting,
    showMetadata,
    setShowMetadata,
    nodeColors,
    setNodeColors,
    viewMode,
    setViewMode,
    combinedPage,
    setCombinedPage,
    combinedPageSize,
    
    // Derived state
    defaultPalette,
    sourceColorMap,
    
    // Query state
  concordanceData: concordanceQuery.data as ConcordanceAnalysisResponse | null,
    isSearching: concordanceQuery.isLoading,
    searchError: concordanceQuery.error,
    
    // Actions
    executeSearch,
    resetSearch,
    detachConcordance: detachConcordanceMutation.mutateAsync,
    isDetaching: detachConcordanceMutation.isPending,
  };
};
