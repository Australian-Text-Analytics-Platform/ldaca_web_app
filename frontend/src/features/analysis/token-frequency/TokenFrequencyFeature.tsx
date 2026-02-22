import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '../../../hooks/useWorkspaceStatus';
import { useAuth } from '../../../hooks/useAuth';
import { workspacesApi } from '../../../api/workspaces';
import { TokenFrequencyRequest, TokenFrequencyResponse, textApi } from '../../../api/text';
import { resolveTokenFrequencyNodeContext, type TokenFrequencyAnalysisParams } from '../../../components/tabs/tokenFrequencyHelpers';
import { ANALYSIS_LOCKED_MESSAGE } from '../../../components/tabs/AnalysisLockedNotice';
import AnalysisTaskBanner from '../../../components/tabs/AnalysisTaskBanner';
import type { AnalysisTaskStatus } from '../../../hooks/useAnalysisTaskStatus';
import useAnalysisTaskLifecycle, { type AnalysisTaskRefreshContext } from '../../../hooks/useAnalysisTaskLifecycle';
import { Wordcloud } from '@visx/wordcloud';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import HelpIcon from '../../../components/help/HelpIcon';
import { Play, Loader2, Trash2, Table2, Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Text } from '@visx/text';
import { toast } from 'sonner';
import { type NodeColumnSelection } from '../../../hooks/useAutoNodeColumns';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { useUIStore } from '../../../stores';
import { useAnalysisStore } from '../../../stores/analysisStore';
import { getAnalysisActionState } from '../common/analysisActionState';
import {
  clampDisplayTokenLimit,
  DEFAULT_TOKEN_LIMIT,
  toFiniteNumber,
  formatNumber,
  isNonEmptyString,
  parseAnalysisNodeRequest,
  restoreAnalysisLockFromRequest,
  useAnalysisHydration,
  useAnalysisLockMachine,
  useNodeColorPalette,
} from '../common';
import {
  buildSelectionNameKey,
  buildSelectionNameById,
  deriveBackendTokenLimit,
  deriveBackendStopWordsKey,
} from './tokenFrequencyUtils';

/**
 * Normalized node result structure for token frequency analysis
 * Separates node ID (unique identifier) from display name (presentation)
 */
type NormalizedNodeResult = {
  /** Unique node identifier (used for keying) */
  nodeId: string;
  /** Human-readable display name */
  displayName: string;
  /** Token frequency data rows */
  rows: any[];
  /** Additional metadata from backend */
  metadata: Record<string, unknown>;
};

type NodeResultView = NormalizedNodeResult & {
  /** Rows remaining after applying the stop word filter (no limit yet) */
  filteredRows: any[];
  /** Rows actually rendered in charts/word clouds after limit backfilling */
  displayRows: any[];
  /** Count of rows removed by stop words */
  filteredOutCount: number;
  /** Limit applied to the display rows (null when unlimited) */
  appliedDisplayLimit: number | null;
  /** Maximum frequency in the full dataset (for consistent scaling) */
  maxFrequency: number;
};

/**
 * Extracts data rows from various backend response formats
 * @param entry - Backend response entry (array or object with data property)
 * @returns Array of rows or empty array
 */
const extractRows = (entry: unknown): any[] => {
  if (Array.isArray(entry)) {
    return entry as any[];
  }
  if (
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    Array.isArray((entry as any).data)
  ) {
    return (entry as any).data as any[];
  }
  return [];
};

/**
 * Extracts metadata object from backend response entry
 * @param entry - Backend response entry
 * @returns Metadata object or empty object
 */
const extractMetadata = (entry: unknown): Record<string, unknown> => {
  if (
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    (entry as any).metadata &&
    typeof (entry as any).metadata === 'object'
  ) {
    return (entry as any).metadata as Record<string, unknown>;
  }
  return {};
};

/**
 * Safe max helper that avoids `Math.max(...bigArray)` which can throw
 * `RangeError: Maximum call stack size exceeded` for large arrays.
 */
const maxBy = <T,>(items: T[], selector: (item: T) => number, fallback: number): number => {
  let max = fallback;
  for (const item of items) {
    const value = selector(item);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max;
};

const STATS_SORT_ACCESSORS: Record<string, (stat: any) => unknown> = {
  token: (stat) => stat.token,
  freq_corpus_0: (stat) => stat.freq_corpus_0,
  percent_corpus_0: (stat) => stat.percent_corpus_0,
  freq_corpus_1: (stat) => stat.freq_corpus_1,
  percent_corpus_1: (stat) => stat.percent_corpus_1,
  log_likelihood_llv: (stat) => stat.log_likelihood_llv,
  percent_diff: (stat) => stat.percent_diff,
  bayes_factor_bic: (stat) => stat.bayes_factor_bic,
  effect_size_ell: (stat) => stat.effect_size_ell,
  relative_risk: (stat) => stat.relative_risk,
  log_ratio: (stat) => stat.log_ratio,
  odds_ratio: (stat) => stat.odds_ratio,
};

// Token limit is a UI preference only. We keep a hard max of 100 for the input
// as a sanity check, but we still store the full backend result in `results`.
const MAX_TOKEN_LIMIT_INPUT = 100;
const UNIFIED_WORDCLOUD_MAX_WIDTH = 860;
const UNIFIED_WORDCLOUD_HEIGHT = 260;

function TokenFrequencyFeature() {
  const { selectedNodes } = useWorkspaceSelection();
  const { selectNodes } = useWorkspaceActions();
  const { currentWorkspaceId } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const { getAuthHeaders } = useAuth();
  const currentView = useUIStore((state) => state.currentView);
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const setPendingConcordance = useAnalysisStore((state) => state.setPendingConcordance);
  const setTasks = useAnalysisStore((state) => state.setTasks);

  const isActiveTab = currentView === 'token-frequency';

  const {
    isLocked,
    lockWithSnapshots,
    unlockSelection,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
    activeNodeColumnSelections,
    nodeIdToName,
    lockedNodeNameMap,
    displayNodeCount,
    panelSelectedNodes,
  } = useAnalysisLockMachine({
    allowedDataTypes: ['string'],
    maxNodes: 2,
    docTypeOnly: true,
    enableHeuristicGuess: false,
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
  });

  const effectiveNodeColumnSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const [stopWords, setStopWords] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingStopWords, setIsLoadingStopWords] = useState(false);
  const [results, setResults] = useState<TokenFrequencyResponse | null>(null);
  const [localTokenFrequencyTaskId, setLocalTokenFrequencyTaskId] = useState<string | null>(null);
  // Statistical table head/tail preview & sorting
  const [headTailN, setHeadTailN] = useState<number>(10);
  // Sorting state (supports tri-state: none -> desc -> asc -> none)
  const [statsSortColumn, setStatsSortColumn] = useState<string>('log_likelihood_llv');
  const [statsSortDirection, setStatsSortDirection] = useState<'asc'|'desc'>('desc');
  const [showFullStatsModal, setShowFullStatsModal] = useState(false);
  // Modal pagination (number_of_columns) and page state
  const [modalPageSize, setModalPageSize] = useState<number>(50); // number_of_columns
  const [modalPage, setModalPage] = useState<number>(1);
  // Dynamic color management for selected nodes
  const [lastCompareNodeIds, setLastCompareNodeIds] = useState<string[]>([]); // preserves order used in last analysis
  // Locally-applied stop word filter (no recomputation)
  const [appliedStopSet, setAppliedStopSet] = useState<Set<string>>(new Set());
  const [tokenLimitOverride, setTokenLimitOverride] = useState<number | null>(null);
  const [tokenLimitInput, setTokenLimitInput] = useState<string>('');
  const [tokenLimitError, setTokenLimitError] = useState<string | null>(null);
  const [isApplyingTokenLimit, setIsApplyingTokenLimit] = useState(false);
  const previousBackendLimitRef = useRef<number | null>(null);
  const tokenLimitInputChangedRef = useRef(false);
  const wordCloudRefs = useRef<Record<string, SVGSVGElement | null>>({});
  const wordCloudExportScale = 3;
  const fallbackStopWordsRef = useRef<string[]>([]);
  const hydratedRequestAvailableRef = useRef(false);
  const unifiedCloudContainerRef = useRef<HTMLDivElement | null>(null);
  const [unifiedCloudWidth, setUnifiedCloudWidth] = useState<number>(UNIFIED_WORDCLOUD_MAX_WIDTH);
  const resolvedTokenTaskIdRef = useRef<{ workspaceId: string | null; taskId: string | null }>({
    workspaceId: null,
    taskId: null,
  });
  const resolveTokenTaskInflightRef = useRef<Promise<string | null> | null>(null);
  const hydratedOnceRef = useRef(false);
  const previousWorkspaceIdRef = useRef<string | null>(null);
  const successfulTaskRefreshRef = useRef<string | null>(null);

  const resolveTokenFrequencyTaskId = useCallback(async (): Promise<string | null> => {
    if (!currentWorkspaceId) {
      return null;
    }

    if (resolvedTokenTaskIdRef.current.workspaceId !== currentWorkspaceId) {
      resolvedTokenTaskIdRef.current = { workspaceId: currentWorkspaceId, taskId: null };
      resolveTokenTaskInflightRef.current = null;
    }

    const cachedTaskId = resolvedTokenTaskIdRef.current.taskId;
    if (cachedTaskId) {
      return cachedTaskId;
    }

    const candidateIds = [
      localTokenFrequencyTaskId,
      (results as any)?.metadata?.task_id,
    ];
    const known = candidateIds.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
    if (known) {
      resolvedTokenTaskIdRef.current = { workspaceId: currentWorkspaceId, taskId: known };
      return known;
    }

    if (resolveTokenTaskInflightRef.current) {
      return resolveTokenTaskInflightRef.current;
    }

    const inflight = (async () => {
      try {
        const headers = getAuthHeaders();
        const current = await textApi.getAnalysisCurrent('token_frequencies', headers) as any;
        const taskId = Array.isArray(current?.task_ids) ? current.task_ids[0] : null;
        if (typeof taskId === 'string' && taskId.trim().length > 0) {
          setLocalTokenFrequencyTaskId(taskId);
          resolvedTokenTaskIdRef.current = { workspaceId: currentWorkspaceId, taskId };
          return taskId;
        }
      } catch {
        return null;
      } finally {
        resolveTokenTaskInflightRef.current = null;
      }

      return null;
    })();

    resolveTokenTaskInflightRef.current = inflight;
    return inflight;
  }, [currentWorkspaceId, getAuthHeaders, localTokenFrequencyTaskId, results]);

  const selectedNodeIds = selectedNodes.map((node) => node.id).sort();
  const selectedNodeIdsKey = selectedNodeIds.join('|');

  const applyTokenLimitState = useCallback((rawLimit: number | null | undefined) => {
    const target = typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0
      ? rawLimit
      : DEFAULT_TOKEN_LIMIT;
    const { limit: normalizedLimit } = clampDisplayTokenLimit(target);
    const inputLimit = Math.min(normalizedLimit, MAX_TOKEN_LIMIT_INPUT);
    setTokenLimitOverride(inputLimit);
    setTokenLimitInput(String(inputLimit));
    setTokenLimitError(null);
    previousBackendLimitRef.current = inputLimit;
    tokenLimitInputChangedRef.current = false;
  }, [setTokenLimitOverride, setTokenLimitInput, setTokenLimitError]);

  const selectionNameById = buildSelectionNameById(
    selectedNodes as Array<{ id: string; name?: string | null }>,
    panelSelectedNodes as Array<{ id: string; name?: string | null }> | null | undefined
  );
  const selectionNameKey = buildSelectionNameKey(
    selectedNodes as Array<{ id: string; name?: string | null }>,
    panelSelectedNodes as Array<{ id: string; name?: string | null }> | null | undefined
  );

  const paletteNodes = useMemo(() => {
    const sourceNodes =
      Array.isArray(panelSelectedNodes) && panelSelectedNodes.length > 0
        ? panelSelectedNodes
        : selectedNodes;
    return sourceNodes.map((node) => ({
      id: node.id,
      label: (node as any)?.name ?? node.id,
    }));
  }, [panelSelectedNodes, selectedNodes]);

  const responseDisplayNameHints: Record<string, string> = useMemo(() => {
    const mapping: Record<string, string> = {};
    const metadataNodeNames = ((results?.metadata as Record<string, unknown> | null | undefined)?.node_display_names ?? {}) as Record<string, unknown>;
    if (metadataNodeNames && typeof metadataNodeNames === 'object') {
      Object.entries(metadataNodeNames).forEach(([id, name]) => {
        if (isNonEmptyString(name)) {
          mapping[id] = name;
        }
      });
    }
    if (results?.data && typeof results.data === 'object') {
      Object.entries(results.data as Record<string, unknown>).forEach(([key, value]) => {
        const entryMetadata = extractMetadata(value);
        const metaNodeId = entryMetadata['node_id'];
        const metaDisplayName = entryMetadata['display_name'];
        if (isNonEmptyString(metaNodeId) && isNonEmptyString(metaDisplayName)) {
          mapping[metaNodeId] = metaDisplayName;
        } else if (isNonEmptyString(metaNodeId) && !mapping[metaNodeId] && isNonEmptyString(key)) {
          mapping[metaNodeId] = key;
        }
      });
    }
    return mapping;
  }, [results]);

  const computeDisplayName = (nodeId: string, fallbackKey?: string) => {
    if (isNonEmptyString(responseDisplayNameHints[nodeId])) {
      return responseDisplayNameHints[nodeId];
    }
    if (isNonEmptyString(lockedNodeNameMap[nodeId])) {
      return lockedNodeNameMap[nodeId];
    }
    if (isNonEmptyString(nodeIdToName[nodeId])) {
      return nodeIdToName[nodeId];
    }
    if (isNonEmptyString(selectionNameById[nodeId])) {
      return selectionNameById[nodeId];
    }
    if (isNonEmptyString(fallbackKey)) {
      return fallbackKey;
    }
    return nodeId;
  };

  const analysisNodeIds = useMemo(() => {
    const combined: Array<string | null | undefined> = [];
    const paramsNodeIds = (results?.analysis_params as Record<string, unknown> | null | undefined)?.node_ids;
    if (Array.isArray(paramsNodeIds)) {
      combined.push(...paramsNodeIds);
    }
    combined.push(...lastCompareNodeIds);
    combined.push(...effectiveNodeColumnSelections.map((sel) => sel.nodeId));
    const seen = new Set<string>();
    const deduped: string[] = [];
    combined.forEach((id) => {
      if (isNonEmptyString(id) && !seen.has(id)) {
        seen.add(id);
        deduped.push(id);
      }
    });
    return deduped;
  }, [effectiveNodeColumnSelections, lastCompareNodeIds, results]);

  const {
    nodeColors,
    setNodeColor,
    getColorForNode,
    palette: nodeColorPalette,
  } = useNodeColorPalette({
    nodeIds: analysisNodeIds.length > 0 ? analysisNodeIds : selectedNodeIds,
    nodes: paletteNodes,
  });

  const normalizedNodeResults: NormalizedNodeResult[] = useMemo(() => {
    if (!results?.data || typeof results.data !== 'object') {
      return [];
    }

    const dataRecord = results.data as Record<string, unknown>;
    const entries = Object.entries(dataRecord);
    const usedKeys = new Set<string>();
    const nodeIds = analysisNodeIds.length > 0 ? analysisNodeIds : entries.map(([key]) => key);

    const normalized: NormalizedNodeResult[] = nodeIds.map((nodeId, index) => {
      const fallbackKey = entries[index]?.[0];
      const displayName = computeDisplayName(nodeId, fallbackKey);
      let entry: unknown;
      let entryKey: string | null = null;

      if (Object.prototype.hasOwnProperty.call(dataRecord, nodeId)) {
        entry = dataRecord[nodeId];
        entryKey = nodeId;
      } else if (Object.prototype.hasOwnProperty.call(dataRecord, displayName)) {
        entry = dataRecord[displayName];
        entryKey = displayName;
      } else {
        const match = entries.find(([key, value]) => {
          if (usedKeys.has(key)) {
            return false;
          }
          const meta = extractMetadata(value);
          const metaNodeId = meta['node_id'];
          const metaDisplayName = meta['display_name'];
          if (isNonEmptyString(metaNodeId) && metaNodeId === nodeId) {
            return true;
          }
          if (isNonEmptyString(metaDisplayName) && metaDisplayName.toLowerCase() === displayName.toLowerCase()) {
            return true;
          }
          return false;
        });
        if (match) {
          entryKey = match[0];
          entry = match[1];
        }
      }

      if (!entry) {
        const fallbackEntry = entries.find(([key]) => !usedKeys.has(key));
        if (fallbackEntry) {
          entryKey = fallbackEntry[0];
          entry = fallbackEntry[1];
        }
      }

      if (entryKey) {
        usedKeys.add(entryKey);
      }

      const metadata = extractMetadata(entry);
      const rows = extractRows(entry);

      return {
        nodeId,
        displayName,
        rows,
        metadata,
      };
    });

    // Only include entries from analysisNodeIds - do NOT add extra unmatched entries
    // This ensures the results panel only shows nodes that were actually locked/analyzed
    return normalized;
  }, [analysisNodeIds, nodeIdToName, lockedNodeNameMap, responseDisplayNameHints, results?.data, selectionNameKey]);


  const backendTokenLimit = deriveBackendTokenLimit(results);
  useEffect(() => {
    const backendLimit =
      typeof backendTokenLimit === 'number' && Number.isFinite(backendTokenLimit)
        ? backendTokenLimit
        : null;
    if (backendLimit !== null) {
      const { limit: sanitizedBackendLimit } = clampDisplayTokenLimit(backendLimit);
      if (
        previousBackendLimitRef.current !== sanitizedBackendLimit ||
        tokenLimitOverride !== sanitizedBackendLimit
      ) {
        applyTokenLimitState(sanitizedBackendLimit);
      }
    } else if (tokenLimitOverride === null) {
      applyTokenLimitState(DEFAULT_TOKEN_LIMIT);
    }
  }, [backendTokenLimit, tokenLimitOverride, applyTokenLimitState]);

  const backendStopWordsKey = deriveBackendStopWordsKey(results);

  useEffect(() => {
    if (!results) {
      setStopWords('');
      setAppliedStopSet(new Set());
      return;
    }
    const normalized = backendStopWordsKey
      ? backendStopWordsKey.split('|').filter((w) => w.length > 0)
      : [];
    const joined = normalized.join(', ');
    setStopWords(joined);
    setAppliedStopSet(new Set(normalized));
  }, [backendStopWordsKey, results]);

  const effectiveTokenLimit = (() => {
    if (typeof tokenLimitOverride === 'number' && Number.isFinite(tokenLimitOverride)) {
      return Math.min(tokenLimitOverride, MAX_TOKEN_LIMIT_INPUT);
    }
    if (typeof backendTokenLimit === 'number' && Number.isFinite(backendTokenLimit)) {
      return Math.min(clampDisplayTokenLimit(backendTokenLimit).limit, MAX_TOKEN_LIMIT_INPUT);
    }
    return DEFAULT_TOKEN_LIMIT;
  })();

  // Memoized helper describing filtered + backfilled rows for each node
  const nodeDisplayResults: NodeResultView[] = useMemo(() => {
    const normalizedLimit =
      typeof effectiveTokenLimit === 'number' && Number.isFinite(effectiveTokenLimit)
        ? Math.max(0, Math.floor(effectiveTokenLimit))
        : null;

    const hasStopFilter = appliedStopSet && appliedStopSet.size > 0;
    const shouldFilterToken = (token: unknown) => {
      if (!hasStopFilter) return false;
      const normalizedToken = String(token ?? '').toLowerCase();
      return appliedStopSet.has(normalizedToken);
    };

    return normalizedNodeResults.map((result) => {
      const rawRows = Array.isArray(result.rows) ? result.rows : [];
      const filteredRows = hasStopFilter
        ? rawRows.filter((row) => !shouldFilterToken(row?.token))
        : rawRows;

      let displayRows: any[];
      if (normalizedLimit === null || normalizedLimit <= 0) {
        displayRows = filteredRows;
      } else {
        const limitedRows: any[] = [];
        for (const row of rawRows) {
          if (shouldFilterToken(row?.token)) continue;
          limitedRows.push(row);
          if (limitedRows.length >= normalizedLimit) break;
        }
        displayRows = limitedRows;
      }

      const maxFrequencyRaw = rawRows.length > 0 ? maxBy(rawRows, (r: any) => Number(r?.frequency) || 0, 0) : 0;
      const maxFrequency = maxFrequencyRaw > 0 ? maxFrequencyRaw : 1;

      return {
        ...result,
        rows: rawRows,
        filteredRows,
        displayRows,
        filteredOutCount: rawRows.length - filteredRows.length,
        appliedDisplayLimit: normalizedLimit,
        maxFrequency,
      };
    });
  }, [appliedStopSet, effectiveTokenLimit, normalizedNodeResults]);

  const filteredStatistics = useMemo(() => {
    if (!Array.isArray(results?.statistics)) {
      return [];
    }
    return results.statistics
      .filter((stat: any) => !appliedStopSet.has(String(stat.token || '').toLowerCase()))
      .filter((stat: any) => Number(stat.log_likelihood_llv) > 0);
  }, [appliedStopSet, results?.statistics]);

  const sortedStatistics = useMemo(() => {
    if (filteredStatistics.length === 0) {
      return [];
    }
    const columnKey = statsSortColumn || 'log_likelihood_llv';
    const direction = statsSortDirection === 'asc' ? 1 : -1;
    return [...filteredStatistics].sort((a, b) => {
      if (columnKey === 'significance') {
        const rank = (stat: any) => (stat.significance || '').length;
        const va = rank(a);
        const vb = rank(b);
        return direction * (va - vb);
      }

      const accessor = STATS_SORT_ACCESSORS[columnKey];
      if (!accessor) {
        return 0;
      }

      const va = accessor(a);
      const vb = accessor(b);
      if (typeof va === 'string' || typeof vb === 'string') {
        const sa = (va ?? '').toString();
        const sb = (vb ?? '').toString();
        if (sa === sb) return 0;
        return direction * (sa < sb ? -1 : 1);
      }

      const numA = Number(va);
      const numB = Number(vb);
      const na = Number.isFinite(numA) ? numA : -Infinity;
      const nb = Number.isFinite(numB) ? numB : -Infinity;
      return direction * (na - nb);
    });
  }, [filteredStatistics, statsSortColumn, statsSortDirection]);

  const shouldRenderUnifiedWordCloud = normalizedNodeResults.length === 2 && lastCompareNodeIds.length === 2;

  const persistTokenPreferences = useCallback(
    async (prefs: { token_limit?: number; stop_words?: string[] }) => {
      if (!currentWorkspaceId) return;
      const taskId = await resolveTokenFrequencyTaskId();
      if (!taskId) return;
      const payload: Record<string, any> = {};
      if (prefs.token_limit !== undefined) {
        payload.token_limit = Math.min(
          clampDisplayTokenLimit(prefs.token_limit).limit,
          MAX_TOKEN_LIMIT_INPUT
        );
      }
      if (prefs.stop_words !== undefined) {
        payload.stop_words = prefs.stop_words;
      }
      if (Object.keys(payload).length === 0) return;
      await textApi.postTokenFrequenciesTaskResult(taskId, payload, getAuthHeaders());
    },
    [currentWorkspaceId, getAuthHeaders, resolveTokenFrequencyTaskId]
  );

  const fetchCurrentRequest = useCallback(async (taskId?: string | null) => {
    if (!currentWorkspaceId || !taskId) return null;
    return textApi.getTaskRequest(taskId, getAuthHeaders());
  }, [currentWorkspaceId, getAuthHeaders]);

  const fetchCurrentResult = useCallback(async (taskId?: string | null) => {
    if (!currentWorkspaceId || !taskId) return null;
    return textApi.getTokenFrequenciesTaskResult(taskId, getAuthHeaders());
  }, [currentWorkspaceId, getAuthHeaders]);

  const refreshCurrentTokenFrequencyResult = useCallback(async () => {
    if (!currentWorkspaceId) {
      return null;
    }

    try {
      const taskId = await resolveTokenFrequencyTaskId();
      if (!taskId) {
        return null;
      }
      const response = await textApi.getTokenFrequenciesTaskResult(taskId, getAuthHeaders());
      const typedResponse = response as TokenFrequencyResponse | null;
      if (typedResponse) {
        setResults(typedResponse);
      }
      return typedResponse;
    } catch (error) {
      console.error('Failed to refresh token frequency results automatically', error);
      return null;
    }
  }, [currentWorkspaceId, getAuthHeaders, resolveTokenFrequencyTaskId, setResults]);

  const tokenFrequencyFallbackBanner = useCallback(
    (status: AnalysisTaskStatus) => {
      if (results?.state !== 'running') {
        return null;
      }

      return {
        taskId:
          (results as any)?.metadata?.task_id ??
          localTokenFrequencyTaskId ??
          status.activeTaskId ??
          null,
        message:
          status.bannerMessage?.trim() ||
          results.message?.trim() ||
          'Token frequency analysis is running…',
      };
    },
    [results, localTokenFrequencyTaskId]
  );

  const handleTokenFrequencyTaskRefresh = useCallback(
    async (context: AnalysisTaskRefreshContext) => {
      if (context.reason !== 'terminal') {
        return;
      }

      const currentState = results?.state;
      const isTerminalState =
        currentState === 'successful' ||
        currentState === 'failed' ||
        currentState === 'cancelled';
      const resultTaskId = (results as any)?.metadata?.task_id ?? null;
      if (isTerminalState && context.taskId && resultTaskId === context.taskId) {
        return;
      }

      const refreshed = await refreshCurrentTokenFrequencyResult();
      if (!refreshed && context.reason === 'terminal' && context.taskState === 'failed') {
        setResults({
          state: 'failed',
          message: context.task?.message || 'Token frequency analysis failed',
          data: null,
        } as TokenFrequencyResponse);
      }

      if (context.reason === 'terminal' && context.taskId) {
        setLocalTokenFrequencyTaskId((prev) => (prev === context.taskId ? null : prev));
      }
    },
    [refreshCurrentTokenFrequencyResult, results, setResults]
  );

  const {
    status: tokenFrequencyTaskStatus,
    banner: tokenFrequencyWaitingBanner,
  } = useAnalysisTaskLifecycle({
    taskType: 'token_frequencies',
    isTabActive: isActiveTab,
    workspaceId: currentWorkspaceId,
    manualActiveTaskId: results?.state === 'running' ? localTokenFrequencyTaskId : null,
    fallbackRunningBanner: tokenFrequencyFallbackBanner,
    onRefresh: handleTokenFrequencyTaskRefresh,
  });

  const tokenSuccessfulTask = tokenFrequencyTaskStatus.successfulTask;

  useEffect(() => {
    if (!isActiveTab) {
      return;
    }

    const successfulTaskId = tokenSuccessfulTask?.task_id ?? null;
    if (!successfulTaskId) {
      return;
    }

    if (successfulTaskRefreshRef.current === successfulTaskId) {
      return;
    }

    successfulTaskRefreshRef.current = successfulTaskId;
    setIsAnalyzing(false);
    setLocalTokenFrequencyTaskId((prev) => (prev === successfulTaskId ? null : prev));
    void refreshCurrentTokenFrequencyResult();
  }, [isActiveTab, refreshCurrentTokenFrequencyResult, tokenSuccessfulTask]);

  const hasActiveTask = Boolean(
    localTokenFrequencyTaskId ||
    tokenFrequencyTaskStatus.activeTaskId ||
    tokenFrequencyTaskStatus.runningTask?.task_id ||
    tokenFrequencyTaskStatus.queuedTask?.task_id ||
    tokenFrequencyTaskStatus.terminalTask?.task_id ||
    tokenFrequencyTaskStatus.tasks.length > 0
  );
  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: selectedNodes.length > 0,
    isLocked,
    hasResults: Boolean(results),
    isBusy: isAnalyzing,
    hasActiveTask,
  });

  const applyHydratedRequest = useCallback(
    async (requestPayload: any | null) => {
      fallbackStopWordsRef.current = [];
      hydratedRequestAvailableRef.current = false;

      const requestData = (requestPayload as any)?.data ?? requestPayload ?? null;
      if (!requestData) {
        setStopWords('');
        setAppliedStopSet(new Set());
        setNodeColumnSelections([], { replace: true });
        setLastCompareNodeIds([]);
        setResults(null);
        applyTokenLimitState(DEFAULT_TOKEN_LIMIT);
        unlockSelection();
        return;
      }

      hydratedRequestAvailableRef.current = true;

      if (Array.isArray(requestData.stop_words)) {
        fallbackStopWordsRef.current = requestData.stop_words
          .map((word: any) => String(word).trim().toLowerCase())
          .filter((word: string) => word.length > 0);
      }

      const { nodeIds, selections } = parseAnalysisNodeRequest(requestData, 2);
      setNodeColumnSelections(selections, { replace: true });
      setLastCompareNodeIds(nodeIds);

      const limitFromRequest = toFiniteNumber(requestData.token_limit ?? requestData.limit);
      applyTokenLimitState(limitFromRequest ?? undefined);
      if (nodeIds.length && currentWorkspaceId) {
        try {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData,
            getAuthHeaders,
            lockWithSnapshots,
            maxNodes: 2,
          });
        } catch {
          /* ignore snapshot failures */
        }
      } else {
        unlockSelection();
      }
    },
    [
      applyTokenLimitState,
      currentWorkspaceId,
      getAuthHeaders,
      lockWithSnapshots,
      setAppliedStopSet,
      setLastCompareNodeIds,
      setNodeColumnSelections,
      setResults,
      setStopWords,
      unlockSelection,
    ]
  );

  const applyHydratedResult = useCallback(
    async (resultPayload: TokenFrequencyResponse | null | undefined) => {
      if (!hydratedRequestAvailableRef.current) {
        setResults(null);
        return;
      }

      if (resultPayload) {
        setResults(resultPayload);
        return;
      }

      const fallback = fallbackStopWordsRef.current;
      if (fallback.length) {
        setStopWords(fallback.join(', '));
        setAppliedStopSet(new Set(fallback));
      } else {
        setStopWords('');
        setAppliedStopSet(new Set());
      }
    },
    [setAppliedStopSet, setResults, setStopWords]
  );

  const { hydrateFromServer } = useAnalysisHydration<
    any,
    TokenFrequencyResponse | null,
    { token_limit?: number; stop_words?: string[] }
  >(
    {
      workspaceId: currentWorkspaceId,
      analysisKey: 'token_frequencies',
      getAuthHeaders,
      onTaskIdResolved: setLocalTokenFrequencyTaskId,
      fetchRequest: fetchCurrentRequest,
      fetchResult: fetchCurrentResult,
      applyRequest: applyHydratedRequest,
      applyResult: applyHydratedResult,
      persistPreferences: persistTokenPreferences,
      autoHydrateOnFocus: false,
      autoHydrateOnVisibility: false,
    }
  );

  const hydrateRef = useRef(hydrateFromServer);
  useEffect(() => {
    hydrateRef.current = hydrateFromServer;
  }, [hydrateFromServer]);

  const updateResultsPreferencesLocally = useCallback(
    (prefs: { tokenLimit?: number; stopWords?: string[] }) => {
      setResults((prev) => {
        if (!prev) return prev;
        const metadata = {
          ...(((prev as any)?.metadata) ?? {}),
        } as Record<string, any>;
        const analysisParams = {
          ...(prev.analysis_params ?? {}),
        } as Record<string, any>;

        let nextTokenLimit: number | undefined;
        const existingTokenLimit =
          typeof prev.token_limit === 'number' && Number.isFinite(prev.token_limit)
            ? prev.token_limit
            : undefined;
        if (prefs.tokenLimit !== undefined) {
          nextTokenLimit = prefs.tokenLimit;
        } else {
          nextTokenLimit = existingTokenLimit;
        }

        if (nextTokenLimit !== undefined && Number.isFinite(nextTokenLimit)) {
          const { limit: normalizedLimit } = clampDisplayTokenLimit(nextTokenLimit);
          const inputLimit = Math.min(normalizedLimit, MAX_TOKEN_LIMIT_INPUT);
          metadata.token_limit = inputLimit;
          analysisParams.token_limit = inputLimit;
          nextTokenLimit = inputLimit;
        }

        delete metadata.limit;
        delete analysisParams.limit;

        const stopWordsArray =
          prefs.stopWords !== undefined
            ? prefs.stopWords
            : Array.isArray(prev.stop_words)
            ? prev.stop_words
            : Array.isArray(metadata.stop_words)
            ? metadata.stop_words
            : [];

        metadata.stop_words = stopWordsArray;
        analysisParams.stop_words = stopWordsArray;


        return {
          ...prev,
          token_limit: nextTokenLimit ?? undefined,
          analysis_params: analysisParams,
          metadata,
          stop_words: stopWordsArray,
          message: prev.message,
          state: prev.state,
        } as TokenFrequencyResponse;
      });
    },
    [setResults]
  );

  const applyTokenLimitWithValidation = useCallback(async () => {
    tokenLimitInputChangedRef.current = false;

    const parsed = toFiniteNumber(tokenLimitInput);
    if (parsed === null) {
      setTokenLimitError('Enter a whole number greater than zero.');
      return;
    }
    const normalized = Math.floor(parsed);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      setTokenLimitError('Enter a whole number greater than zero.');
      return;
    }
    const { limit: normalizedLimit } = clampDisplayTokenLimit(normalized);
    const targetLimit = Math.min(normalizedLimit, MAX_TOKEN_LIMIT_INPUT);
    if (normalizedLimit > MAX_TOKEN_LIMIT_INPUT) {
      // Keep the input box within its max bound; no modal/alert.
      setTokenLimitInput(String(MAX_TOKEN_LIMIT_INPUT));
    }

    setTokenLimitError(null);

    const limitChanged = targetLimit !== effectiveTokenLimit;

    if (!results || !limitChanged) {
      applyTokenLimitState(targetLimit);
      return;
    }

    setIsApplyingTokenLimit(true);
    try {
      await persistTokenPreferences({ token_limit: targetLimit });
      updateResultsPreferencesLocally({ tokenLimit: targetLimit });
      applyTokenLimitState(targetLimit);
    } catch (error) {
      console.error('Failed to update token limit', error);
      setTokenLimitError('Failed to update token limit. Please try again.');
    } finally {
      setIsApplyingTokenLimit(false);
    }
  }, [
    tokenLimitInput,
    effectiveTokenLimit,
    results,
    persistTokenPreferences,
    updateResultsPreferencesLocally,
    applyTokenLimitState,
  ]);

  // Helper to compute and apply stop set from a comma-separated string
  const saveStopWordsToBackend = useCallback(
    async (words: string[]) => {
      if (!results) return;
      try {
        await persistTokenPreferences({ stop_words: words });
        updateResultsPreferencesLocally({ stopWords: words });
      } catch (e) {
        console.warn('Failed to save stop words', e);
      }
    },
    [results, persistTokenPreferences, updateResultsPreferencesLocally]
  );

  const applyStopSetFromText = (text: string) => {
    const words = text
      .split(',')
      .map(w => w.trim().toLowerCase())
      .filter(Boolean);
    setStopWords(words.join(', '));
    setAppliedStopSet(new Set(words));
    // Persist stop words (UI preference) to backend; calculation does not use them
    void saveStopWordsToBackend(words);
  };

  const handleTokenLimitInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    tokenLimitInputChangedRef.current = true;
    const raw = event.target.value;
    if (!raw) {
      setTokenLimitInput(raw);
      if (tokenLimitError) setTokenLimitError(null);
      return;
    }
    const parsed = toFiniteNumber(raw);
    if (parsed !== null) {
      const floored = Math.floor(parsed);
      if (Number.isFinite(floored) && floored > MAX_TOKEN_LIMIT_INPUT) {
        setTokenLimitInput(String(MAX_TOKEN_LIMIT_INPUT));
        if (tokenLimitError) setTokenLimitError(null);
        return;
      }
    }
    setTokenLimitInput(raw);
    if (tokenLimitError) setTokenLimitError(null);
  };

  const handleTokenLimitBlur = () => {
    void applyTokenLimitWithValidation();
  };

  const handleTokenLimitKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void applyTokenLimitWithValidation();
    }
  };

  useEffect(() => {
    if (!currentWorkspaceId || !isActiveTab) return;
    if (previousWorkspaceIdRef.current !== currentWorkspaceId) {
      hydratedOnceRef.current = false;
      previousWorkspaceIdRef.current = currentWorkspaceId;
    }
    void (async () => {
      if (hydratedOnceRef.current) return;
      hydratedOnceRef.current = true;
      await hydrateRef.current();
    })();
  }, [currentWorkspaceId, isActiveTab]);

  useEffect(() => {
    if (!shouldRenderUnifiedWordCloud) return;

    const element = unifiedCloudContainerRef.current;
    if (!element) return;

    const updateWidth = (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const next = Math.min(UNIFIED_WORDCLOUD_MAX_WIDTH, Math.floor(value));
      setUnifiedCloudWidth((prev) => (prev === next ? prev : next));
    };

    const initialWidth = element.getBoundingClientRect().width;
    if (initialWidth) {
      updateWidth(initialWidth);
    }

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateWidth(entry.contentRect.width);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldRenderUnifiedWordCloud]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setLocalTokenFrequencyTaskId(null);
      resolvedTokenTaskIdRef.current = { workspaceId: null, taskId: null };
      resolveTokenTaskInflightRef.current = null;
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (currentWorkspaceId && !results && !localTokenFrequencyTaskId) {
      if (resolvedTokenTaskIdRef.current.workspaceId === currentWorkspaceId) {
        resolvedTokenTaskIdRef.current = { workspaceId: currentWorkspaceId, taskId: null };
      }
    }
  }, [currentWorkspaceId, results, localTokenFrequencyTaskId]);

  useEffect(() => {
    if (tokenFrequencyTaskStatus.tasks.length === 0) {
      setLocalTokenFrequencyTaskId(null);
    }
  }, [tokenFrequencyTaskStatus.tasks.length]);

  // Reset modal page when sort/filter state changes or modal opens
  useEffect(() => {
    if (showFullStatsModal) {
      setModalPage(1);
    }
  }, [showFullStatsModal, statsSortColumn, statsSortDirection, appliedStopSet]);

  // Clear results when node selection changes  
  // Use a more stable dependency by checking the actual node IDs
  useEffect(() => {
    if (!isLocked) setResults(null);
  }, [selectedNodeIdsKey, isLocked]);

  // Recompute auto columns if we become unlocked and selections empty while nodes exist
  useEffect(() => {
    if (!isLocked && selectedNodes.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, selectedNodes, nodeColumnSelections, recomputeAutoColumns]);

  const handleColumnChange = (nodeId: string, column: string) => setNodeColumnSelection(nodeId, column);

  const handleFillDefaultStopWords = async () => {
    setIsLoadingStopWords(true);
    try {
    const response = await textApi.defaultStopWords(getAuthHeaders());
    const defaultWords = response?.stopwords ?? (response as any)?.data;
    if (Array.isArray(defaultWords) && defaultWords.length) {
        const joined = defaultWords.join(', ');
        setStopWords(joined);
        // Auto-apply on fill default and persist
        applyStopSetFromText(joined);
      } else {
        console.error('Failed to get default stop words:', response);
      }
    } catch (error) {
      console.error('Error getting default stop words:', error);
    } finally {
      setIsLoadingStopWords(false);
    }
  };

  const handleAnalyze = async () => {
    if (!currentWorkspaceId || selectedNodes.length === 0) {
      return;
    }

    const incompleteSelections = effectiveNodeColumnSelections.filter((sel) => !sel.column);
    if (incompleteSelections.length > 0) {
      toast.error('Please select a text column for all selected data blocks.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const stopWordsArray = stopWords.trim()
        ? stopWords
            .split(',')
            .map(word => word.trim().toLowerCase())
            .filter(word => word.length > 0)
        : undefined;

      const nodeColumns: Record<string, string> = {};
      effectiveNodeColumnSelections.forEach((sel) => {
        if (sel.column) nodeColumns[sel.nodeId] = sel.column;
      });

      const request: TokenFrequencyRequest = {
        node_ids: selectedNodes.slice(0, 2).map(node => node.id),
        node_columns: nodeColumns,
        stop_words: stopWordsArray,
      };

      const response = await textApi.tokenFrequencies(request, getAuthHeaders());
      setResults(response);
      const responseTaskId = (response as any)?.metadata?.task_id;
      if (typeof responseTaskId === 'string' && responseTaskId.trim()) {
        setLocalTokenFrequencyTaskId(responseTaskId);
      }
      setLastCompareNodeIds(request.node_ids);

      if (Array.isArray(response.stop_words)) {
        const normalizedStops = response.stop_words
          .map((word: string) => String(word).trim().toLowerCase())
          .filter(Boolean);
        setAppliedStopSet(new Set(normalizedStops));
        setStopWords(normalizedStops.join(', '));
      }

      try {
        if (request.node_ids.length) {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: request,
            getAuthHeaders,
            lockWithSnapshots,
            maxNodes: 2,
          });
        }
      } catch {
        /* ignore */
      }
    } catch (error) {
      console.error('Error calculating token frequencies:', error);
      setLocalTokenFrequencyTaskId(null);
      setResults({
        state: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: null,
      } as any);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClearResults = async () => {
    if (currentWorkspaceId) {
      const headers = getAuthHeaders();

      const taskIds = new Set<string>();
      const candidates = [
        (results as any)?.metadata?.task_id,
        localTokenFrequencyTaskId,
        tokenFrequencyTaskStatus.activeTaskId,
        tokenFrequencyTaskStatus.runningTask?.task_id,
        tokenFrequencyTaskStatus.queuedTask?.task_id,
        tokenFrequencyTaskStatus.terminalTask?.task_id,
      ];
      candidates.forEach((candidate) => {
        if (typeof candidate === 'string' && candidate.trim()) {
          taskIds.add(candidate);
        }
      });

      if (taskIds.size > 0) {
        await Promise.all(
          Array.from(taskIds).map(async (taskId) => {
            try {
              await workspacesApi.cancelTasks({ task_id: taskId }, headers);
            } catch (error) {
              console.warn('Failed to cancel token frequency task before clearing', { taskId, error });
            }
          })
        );
        await Promise.all(
          Array.from(taskIds).map(async (taskId) => {
            try {
              await workspacesApi.clearTasks({ task_id: taskId }, headers);
            } catch (error) {
              console.warn('Failed to clear token frequency task from task manager', { taskId, error });
            }
          })
        );
      }

      try {
        if (taskIds.size > 0) {
          await Promise.all(
            Array.from(taskIds).map((taskId) => textApi.clearTask(taskId, headers))
          );
        }
      } catch (error) {
        console.error('Failed to clear backend analyses/cache:', error);
      }
    }
    setLocalTokenFrequencyTaskId(null);
    setTasks((prev) => {
      if (!Array.isArray(prev)) return prev;

      const taskIds = new Set<string>();
      const candidates = [
        (results as any)?.metadata?.task_id,
        localTokenFrequencyTaskId,
        tokenFrequencyTaskStatus.activeTaskId,
        tokenFrequencyTaskStatus.runningTask?.task_id,
        tokenFrequencyTaskStatus.queuedTask?.task_id,
        tokenFrequencyTaskStatus.terminalTask?.task_id,
      ];
      candidates.forEach((candidate) => {
        if (typeof candidate === 'string' && candidate.trim()) {
          taskIds.add(candidate);
        }
      });

      if (taskIds.size === 0) {
        return prev;
      }

      return prev.filter((task) => task && !taskIds.has(task.task_id));
    });
    setResults(null);
    setLastCompareNodeIds([]);
  unlockSelection();
    setTokenLimitError(null);
    tokenLimitInputChangedRef.current = false;
  };

  const handleTokenClick = (token: string) => {
    const trimmedToken = token?.toString() ?? '';
    const analysisParams = (results?.analysis_params ?? null) as TokenFrequencyAnalysisParams | null;

    const resolvedContext = resolveTokenFrequencyNodeContext({
      lastCompareNodeIds,
      analysisParams,
      selectedNodes: selectedNodes.map((node) => ({ id: node.id })),
      nodeColumnSelections: effectiveNodeColumnSelections,
      maxNodes: 2,
    });

    const fallbackNodeIds: string[] = resolvedContext.nodeIds.length > 0
      ? resolvedContext.nodeIds
      : selectedNodes
          .slice(0, 2)
          .map((node) => node.id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    const fallbackSelections: NodeColumnSelection[] = resolvedContext.nodeIds.length > 0
      ? resolvedContext.selections
      : effectiveNodeColumnSelections.filter((sel) => fallbackNodeIds.includes(sel.nodeId) && sel.column);

    const uniqueNodeIds: string[] = fallbackNodeIds
      .filter((id, index, arr) => arr.indexOf(id) === index)
      .slice(0, 2);

    const effectiveSelections: NodeColumnSelection[] = fallbackSelections.filter((sel) =>
      uniqueNodeIds.includes(sel.nodeId)
    );

    if (uniqueNodeIds.length > 0) {
      try {
        selectNodes(uniqueNodeIds);
      } catch (e) {
        console.warn('Failed to sync workspace selection for concordance handoff:', e);
      }
    }

    const nodeDetails = uniqueNodeIds.map((id) => ({
      id,
      name: lockedNodeNameMap[id] || nodeIdToName[id] || id,
    }));

    const pendingNodeColors: Record<string, string> = { ...nodeColors };
    uniqueNodeIds.forEach((id, idx) => {
      if (!pendingNodeColors[id]) {
        pendingNodeColors[id] = getColorForNode(id, idx);
      }
    });

    setPendingConcordance({
      searchWord: trimmedToken,
      nodeColumnSelections: effectiveSelections.map((sel) => ({ ...sel })),
      selectedNodes: nodeDetails,
      nodeColors: pendingNodeColors,
      autoRun: false,
      timestamp: Date.now(),
    });

    setCurrentView('concordance');
  };

  // Right-click handler: add token to stop word list if not present
  const handleTokenRightClick = (token: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    const tokenNorm = token.trim().toLowerCase();
    const current = stopWords
      .split(',')
      .map(w => w.trim())
      .filter(Boolean);
    if (!current.map(w => w.toLowerCase()).includes(tokenNorm)) {
      const updated = [...current, token].join(', ');
      setStopWords(updated);
      // Auto-apply when a word is added via right-click
      applyStopSetFromText(updated);
    }
  };


  const toSafeExportFilename = (label: string, suffix: string, extension: string) => {
    const base = (label || 'token-frequency')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'token-frequency';
    return `${base}-${suffix}.${extension}`;
  };

  const triggerFileDownload = (href: string, filename: string) => {
    if (typeof document === 'undefined') return;
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadWordCloud = (nodeKey: string, displayName: string) => {
    if (typeof window === 'undefined') return;
    const svg = wordCloudRefs.current[nodeKey];
    if (!svg) return;

    let width = Number(svg.getAttribute('width')) || svg.clientWidth || 400;
    let height = Number(svg.getAttribute('height')) || svg.clientHeight || 200;
    const viewBox = svg.getAttribute('viewBox');
    if ((!width || !height) && viewBox) {
      const parts = viewBox.split(' ').map((part) => Number(part));
      if (parts.length === 4) {
        width = parts[2] || width;
        height = parts[3] || height;
      }
    }

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (width) clone.setAttribute('width', String(width));
    if (height) clone.setAttribute('height', String(height));

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Number.isFinite(wordCloudExportScale) && wordCloudExportScale > 1 ? wordCloudExportScale : 1;
      const scaledWidth = Math.max(1, Math.round(width * scale));
      const scaledHeight = Math.max(1, Math.round(height * scale));
      canvas.width = scaledWidth;
      canvas.height = scaledHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, scaledWidth, scaledHeight);
      if (scale > 1) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
      }
      context.drawImage(image, 0, 0, scaledWidth, scaledHeight);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/png');
      triggerFileDownload(dataUrl, toSafeExportFilename(displayName || nodeKey, 'wordcloud', 'png'));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };

  const handleDownloadFrequencyCsv = (label: string, rows: any[]) => {
    if (typeof window === 'undefined') return;
    const csvLines = [
      ['word', 'count'],
      ...rows.map((item) => [
        String(item?.token ?? ''),
        String(item?.frequency ?? ''),
      ]),
    ].map((line) =>
      line
        .map((value) => {
          const str = String(value).replace(/"/g, '""');
          return `"${str}"`;
        })
        .join(',')
    );
    const csvContent = csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    triggerFileDownload(url, toSafeExportFilename(label, 'frequencies', 'csv'));
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const renderWordCloud = (nodeKey: string, data: any[], width: number = 400, height: number = 200, color: string, overrideMaxFreq?: number) => {
    // Transform data for word cloud format
    const words = data.map(item => ({
      text: item.token,
      value: item.frequency
    }));

    const computedMaxFrequency = data.length > 0 ? maxBy(data, (d: any) => Number(d?.frequency) || 0, 0) : 0;
    const maxFrequency = overrideMaxFreq ?? (computedMaxFrequency > 0 ? computedMaxFrequency : 1);
    const fontScale = (datum: any) => Math.max(12, Math.min(48, (datum.value / maxFrequency) * 36 + 12));
    const fontSizeSetter = (datum: any) => fontScale(datum);

    return (
      <div className="mb-4 flex w-full justify-center overflow-visible">
        <svg
          ref={(el) => {
            if (!el) {
              delete wordCloudRefs.current[nodeKey];
            } else {
              wordCloudRefs.current[nodeKey] = el;
            }
          }}
          width={width}
          height={height}
          className="overflow-visible"
          style={{ overflow: 'visible' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <Wordcloud
            words={words}
            width={width}
            height={height}
            fontSize={fontSizeSetter}
            font="Segoe UI, Roboto, sans-serif"
            padding={2}
            spiral="archimedean"
            rotate={0}
            random={() => 0.5}
          >
            {(cloudWords) =>
              cloudWords.map((w, _i) => (
                <Text
                  key={w.text}
                  fill={color}
                  textAnchor="middle"
                  transform={`translate(${w.x}, ${w.y})`}
                  fontSize={w.size}
                  fontFamily={w.font}
                  className="cursor-pointer hover:fill-blue-800 transition-colors"
                  onClick={() => w.text && handleTokenClick(w.text)}
                  onContextMenu={e => w.text && handleTokenRightClick(w.text, e)}
                  style={{ cursor: 'pointer' }}
                >
                  {w.text || ''}
                </Text>
              ))
            }
          </Wordcloud>
        </svg>
      </div>
    );
  };

  // Derive filtered results data according to the applied stop-word set
  const renderChart = (nodeId: string, displayName: string, data: any[], color: string, fullRows: any[], maxFrequency?: number) => {
    // Find max frequency for bar width calculation (guard against empty arrays)
    const maxFreqRaw = data.length > 0 ? maxBy(data, (item: any) => Number(item?.frequency) || 0, 0) : 0;
    const maxFreq = maxFreqRaw > 0 ? maxFreqRaw : 1;
    const exportKey = nodeId || displayName;

    return (
      <div className="mb-6" data-node-id={nodeId || displayName}>
        <div className="h-16 mb-4 flex items-center">
          <h3 className="text-lg font-semibold text-gray-800 wrap-break-word leading-tight w-full">{displayName}</h3>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownloadWordCloud(exportKey, displayName)}
          >
            <Download className="mr-2 h-4 w-4" />
            Save Word Cloud (PNG)
          </Button>
        </div>
    {/* Word Cloud */}
    {renderWordCloud(exportKey, data, 400, 200, color, maxFrequency)}

        <div className="bg-white p-4 rounded-lg border">
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownloadFrequencyCsv(displayName || nodeId, fullRows)}
            >
              <Download className="mr-2 h-4 w-4" />
              Save Frequencies (CSV)
            </Button>
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-2">
            {data.map((item, index) => (
              <div key={index} className="flex items-center gap-2 py-1">
                {/* Token label - now clickable and right-clickable */}
                <div
                  className="w-24 shrink-0 text-right text-xs font-semibold text-gray-700 cursor-pointer hover:bg-blue-100 hover:text-blue-700 px-1.5 py-1 rounded-md transition-colors"
                  onClick={() => handleTokenClick(item.token)}
                  onContextMenu={e => handleTokenRightClick(item.token, e)}
                  title={`Left click: concordance; Right click: add to stop words`}
                >
                  <span className="block leading-tight truncate" title={item.token}>
                    {item.token}
                  </span>
                </div>

                {/* Bar container */}
                <div className="flex-1 relative">
                  <div className="h-4 bg-muted rounded-full relative overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${(item.frequency / maxFreq) * 100}%`,
                        minWidth: item.frequency > 0 ? '2px' : '0',
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </div>

                {/* Frequency value */}
                <div className="w-14 text-left text-xs text-gray-600 font-mono tabular-nums leading-tight">
                  {item.frequency}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Token Frequency Analysis
                <HelpIcon
                  targetKey="analysis.token-frequency.parameters"
                  label="Token frequency parameters"
                  tooltip="Choose nodes, text columns, token limits, and stop words before running the analysis."
                />
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <NodeSelectionPanel
            selectedNodes={panelSelectedNodes}
            nodeColumnSelections={effectiveNodeColumnSelections}
            onColumnChange={handleColumnChange}
            nodeColors={nodeColors}
            onColorChange={setNodeColor}
            defaultPalette={nodeColorPalette}
            maxCompare={2}
            className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
            showShape
            disabled={!!isLocked}
            locked={!!isLocked}
            showColorPicker={true}
            getNodeColumns={getColumnInfos}
            allowedDataTypes={['string']}
            originalCount={displayNodeCount}
            lockedMessage={ANALYSIS_LOCKED_MESSAGE}
          />
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-3 pt-0">
          <div className="flex items-center gap-2">
            <Button
              onClick={handleAnalyze}
              disabled={
                actionState.runDisabled ||
                effectiveNodeColumnSelections.some((sel) => !sel.column)
              }
              className="w-full md:w-auto"
            >
              {isAnalyzing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing...</>
              ) : (
                <><Play className="mr-2 h-4 w-4" />Calculate Token Frequencies</>
              )}
            </Button>
            <HelpIcon targetKey="analysis.token-frequency.run" label="Run token frequency" />
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleClearResults}
              variant="destructive"
              disabled={actionState.clearDisabled}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Results
            </Button>
            <HelpIcon targetKey="analysis.token-frequency.clear-results" label="Clear results" />
          </div>
          {appliedStopSet.size > 0 && (
            <span className="text-xs text-muted-foreground">Active filter: {appliedStopSet.size} word{appliedStopSet.size === 1 ? '' : 's'}</span>
          )}
        </CardFooter>

      </Card>

      {tokenFrequencyWaitingBanner && (
        <AnalysisTaskBanner
          analysisName="Token frequency"
          status={tokenFrequencyWaitingBanner.status}
          taskId={tokenFrequencyWaitingBanner.taskId}
          message={tokenFrequencyWaitingBanner.message}
          className="mt-4"
        />
      )}

      {/* Results */}
      {results?.state === 'successful' && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              Token Frequency Results
              <HelpIcon
                targetKey="analysis.token-frequency.results"
                label="Token frequency results"
                tooltip="Review token lists, word clouds, and statistical comparisons. Tip: click any token to open Concordance with the same node selections."
              />
            </CardTitle>
            {results.message && (
              <CardDescription className="text-sm text-muted-foreground">
                {results.message}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
              <>
                <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-4">
                  <div className="flex flex-col gap-2">
                    <span className="uppercase tracking-wide text-[10px] font-semibold text-foreground/80">Number of tokens to show</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Number of tokens to show"
                        type="number"
                        min={1}
                        max={MAX_TOKEN_LIMIT_INPUT}
                        inputMode="numeric"
                        value={tokenLimitInput}
                        onChange={handleTokenLimitInputChange}
                        onKeyDown={handleTokenLimitKeyDown}
                        onBlur={handleTokenLimitBlur}
                        className="h-8 w-24"
                        disabled={isApplyingTokenLimit}
                      />
                      {isApplyingTokenLimit && (
                        <div className="flex items-center text-xs text-muted-foreground gap-1">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Applying…</span>
                        </div>
                      )}
                    </div>
                    <span className={`text-[11px] ${tokenLimitError ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {tokenLimitError ?? `Enter a positive whole number (max ${MAX_TOKEN_LIMIT_INPUT}).`}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="uppercase tracking-wide text-[10px] font-semibold text-foreground/80">Stop words (comma-separated)</span>
                        <HelpIcon targetKey="analysis.token-frequency.stop-words" label="Stop words input" />
                      </div>
                      <Button
                        onClick={handleFillDefaultStopWords}
                        disabled={isLoadingStopWords}
                        variant="outline"
                        size="sm"
                      >
                        {isLoadingStopWords ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</>
                        ) : (
                          'Fill Default'
                        )}
                      </Button>
                    </div>
                    <textarea
                      value={stopWords}
                      onChange={(e) => setStopWords(e.target.value)}
                      onBlur={() => applyStopSetFromText(stopWords)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyStopSetFromText(stopWords);
                        }
                      }}
                      placeholder="the, and, or, but..."
                      rows={4}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Optional: Enter words to exclude from charts. The backend keeps full counts; filtering only affects display.
                    </span>
                  </div>
                </div>

              {normalizedNodeResults.length > 0 ? (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {nodeDisplayResults.map((result, idx) => {
                      const referenceId = isNonEmptyString(result.nodeId) ? result.nodeId : undefined;
                      const colorKey = referenceId ?? lastCompareNodeIds[idx] ?? `${result.displayName}-${idx}`;
                      const color = getColorForNode(colorKey, idx);
                      const display = Array.isArray(result.displayRows)
                        ? result.displayRows
                        : Array.isArray(result.filteredRows)
                        ? result.filteredRows
                        : [];
                      return (
                        <div key={`${result.nodeId || result.displayName}-${idx}`}>
                          {renderChart(
                            result.nodeId,
                            result.displayName,
                            display,
                            color,
                            Array.isArray(result.filteredRows) ? result.filteredRows : result.rows,
                            result.maxFrequency
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Unified Comparative Word Cloud */}
                  {normalizedNodeResults.length === 2 && lastCompareNodeIds.length === 2 && (() => {
                    const nodeAResult = (nodeDisplayResults[0] ?? normalizedNodeResults[0]) ?? null;
                    const nodeBResult = (nodeDisplayResults[1] ?? normalizedNodeResults[1]) ?? null;
                    const nodeAId = nodeAResult?.nodeId ?? lastCompareNodeIds[0] ?? '';
                    const nodeBId = nodeBResult?.nodeId ?? lastCompareNodeIds[1] ?? '';
                    const nodeAName = nodeAResult?.displayName ?? computeDisplayName(nodeAId, nodeAId);
                    const nodeBName = nodeBResult?.displayName ?? computeDisplayName(nodeBId, nodeBId);
                    const nodeAColor = getColorForNode(nodeAId || nodeAName, 0);
                    const nodeBColor = getColorForNode(nodeBId || nodeBName, 1);
                    // Build from statistics table with requested juxRank selection
                    const stats = (results.statistics || [])
                    .filter((s: any) => !appliedStopSet.has(String(s.token || '').toLowerCase()))
                    .map((s: any) => ({
                      token: s.token,
                      o1: s.freq_corpus_0,
                      o2: s.freq_corpus_1,
                      p1: s.percent_corpus_0,
                      p2: s.percent_corpus_1,
                      logratio: s.log_ratio ?? 0,
                    }))
                    .map((s: any) => ({
                      ...s,
                      total: s.o1 + s.o2,
                      juxRank: ((s.o1 + s.o2) > 0 ? Math.log10(s.o1 + s.o2) : 0) * (s.logratio || 0)
                    }))
                    .filter((s: any) => s.total > 10);

                    if (stats.length === 0) return null;

                    const sortedAsc = [...stats].sort((a, b) => a.juxRank - b.juxRank);
                    const limitForCloudBase = typeof effectiveTokenLimit === 'number' ? effectiveTokenLimit : DEFAULT_TOKEN_LIMIT;
                    const cloudLimit = Math.max(0, limitForCloudBase * 2);
                    if (cloudLimit === 0) return null;
                    const half = Math.floor(cloudLimit / 2);
                    const low = sortedAsc.slice(0, Math.min(half, sortedAsc.length));
                    const high = sortedAsc.slice(Math.max(sortedAsc.length - half, 0));
                    let selected = [...low, ...high];

                    // If cloudLimit is odd, add one more from the side with larger absolute extremum not already picked
                    const remaining = Math.max(0, cloudLimit - selected.length);
                    if (remaining > 0 && sortedAsc.length > selected.length) {
                      const nextLow = sortedAsc[low.length] || null;
                      const nextHigh = sortedAsc[sortedAsc.length - high.length - 1] || null;
                      const pick = (() => {
                        const al = nextLow ? Math.abs(nextLow.juxRank) : -1;
                        const ah = nextHigh ? Math.abs(nextHigh.juxRank) : -1;
                        return ah >= al ? nextHigh : nextLow;
                      })();
                      if (pick) selected.push(pick);
                    }

                    // De-duplicate in case of overlap (when cloudLimit > unique items etc.)
                    const seen = new Set<string>();
                    selected = selected.filter(s => (seen.has(s.token) ? false : (seen.add(s.token), true)));

                    // Ensure we don't exceed cloudLimit
                    selected = selected.slice(0, Math.min(cloudLimit, selected.length));

                    const maxTotalRaw = selected.length > 0 ? maxBy(selected, (w: any) => Number(w?.total) || 0, 0) : 0;
                    const maxTotal = maxTotalRaw > 0 ? maxTotalRaw : 1;

                    // Simple hex interpolation
                    const hexToRgb = (hex: string) => {
                      const h = hex.replace('#', '');
                      return {
                        r: parseInt(h.substring(0, 2), 16),
                        g: parseInt(h.substring(2, 4), 16),
                        b: parseInt(h.substring(4, 6), 16)
                      };
                    };
                    const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
                    const colorA = hexToRgb(nodeAColor);
                    const colorB = hexToRgb(nodeBColor);
                    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
                    const blend = (t: number) => {
                      const r = Math.round(lerp(colorB.r, colorA.r, t)); // t=1 -> nodeA
                      const g = Math.round(lerp(colorB.g, colorA.g, t));
                      const b = Math.round(lerp(colorB.b, colorA.b, t));
                      return rgbToHex(r, g, b);
                    };

                    // Prepare words list from selected stats; size = total (O1+O2); color proportion by percentage share
                    const words = selected.map(s => {
                      const pA = s.p1; // percent 0-100
                      const pB = s.p2;
                      const denom = pA + pB;
                      return {
                        text: s.token,
                        value: s.total,
                        proportion: denom > 0 ? (pA / denom) : 0.5,
                      };
                    });

                    const fontScale = (datum: any) => Math.max(12, Math.min(54, datum.value / maxTotal * 42 + 12));
                    const fontSizeSetter = (datum: any) => fontScale(datum);
                    const unifiedKey = `${nodeAId || 'node-a'}-${nodeBId || 'node-b'}-unified`;
                    const unifiedLabel = `${nodeAName} vs ${nodeBName}`;

                    return (
                      <div className="mb-10">
                        <div className="flex items-center justify-between mb-3 flex-wrap gap-4">
                          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
                            Unified Word Cloud
                            <HelpIcon targetKey="analysis.token-frequency.unified-word-cloud" label="Unified word cloud" />
                          </h3>
                          <div className="flex items-center space-x-4 text-sm">
                            <div className="flex items-center space-x-1"><span className="w-4 h-4 inline-block rounded" style={{ background: nodeAColor }}></span><span className="text-gray-700 truncate max-w-35" title={nodeAName}>{nodeAName}</span></div>
                            <div className="flex items-center space-x-1"><span className="w-4 h-4 inline-block rounded" style={{ background: nodeBColor }}></span><span className="text-gray-700 truncate max-w-35" title={nodeBName}>{nodeBName}</span></div>
                            <div className="flex items-center space-x-2">
                              <span className="text-gray-500">Gradient:</span>
                              <div className="h-3 w-32 rounded bg-linear-to-r" style={{ background: `linear-gradient(to right, ${nodeAColor}, ${nodeBColor})` }}></div>
                              <span className="text-gray-500">A → B</span>
                            </div>
                          </div>
                        </div>
                        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownloadWordCloud(unifiedKey, unifiedLabel)}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Save Word Cloud (PNG)
                          </Button>
                        </div>
                        <div ref={unifiedCloudContainerRef} className="mx-auto w-full max-w-215">
                          <svg
                            data-testid="unified-wordcloud-svg"
                            ref={(el) => {
                              if (!el) {
                                delete wordCloudRefs.current[unifiedKey];
                              } else {
                                wordCloudRefs.current[unifiedKey] = el;
                              }
                            }}
                            width={unifiedCloudWidth}
                            height={UNIFIED_WORDCLOUD_HEIGHT}
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <Wordcloud
                              words={words}
                              width={unifiedCloudWidth}
                              height={UNIFIED_WORDCLOUD_HEIGHT}
                              fontSize={fontSizeSetter}
                              font="Segoe UI, Roboto, sans-serif"
                              padding={2}
                              spiral="archimedean"
                              rotate={0}
                              random={() => 0.5}
                            >
                              {(cloudWords) =>
                                cloudWords.map((w: any) => (
                                  <Text
                                    key={w.text}
                                    fill={blend(w.proportion)}
                                    textAnchor="middle"
                                    transform={`translate(${w.x}, ${w.y})`}
                                    fontSize={w.size}
                                    fontFamily={w.font}
                                    className="cursor-pointer transition-colors"
                                    onClick={() => w.text && handleTokenClick(w.text)}
                                    onContextMenu={e => w.text && handleTokenRightClick(w.text, e)}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    {w.text || ''}
                                  </Text>
                                ))
                              }
                            </Wordcloud>
                          </svg>
                        </div>
                        {/* {debugOn && (
                          <div className="mt-2 rounded border border-border bg-muted/40 p-2">
                            <div className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                              {selected
                                .slice()
                                .sort((a,b) => a.juxRank - b.juxRank)
                                .map(s => `${s.token}\t${(Number.isFinite(s.juxRank) ? s.juxRank.toFixed(6) : s.juxRank)}\t(O1:${s.o1}, O2:${s.o2}, LR:${s.logratio.toFixed(6)})`) // eslint-disable-line @typescript-eslint/restrict-plus-operands
                                .join('\n')}
                            </div>
                          </div>
                        )} */}
                      </div>
                    );
                  })()}
                  
                  {/* Statistical Measures Table */}
                  {results.statistics && results.statistics.length > 0 && (
                    <div className="mt-8">
                      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                        Statistical Measures
                        <HelpIcon targetKey="analysis.token-frequency.statistical-measures" label="Statistical measures" />
                      </h3>
                      <div className="mb-4 flex flex-wrap items-center gap-4">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted-foreground">Head/Tail Rows (N)</label>
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={headTailN}
                            onChange={e => setHeadTailN(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
                            className="w-28 rounded-md border border-input px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        </div>
                      </div>
                      
                      {(() => {
                        // Column definitions for sorting
                        const columns: { key: string; label: string; accessor: (s: any) => any; isNumeric?: boolean; formatter?: (v: any, s: any) => React.ReactNode }[] = [
                          { key: 'token', label: 'Token', accessor: s => s.token },
                          { key: 'freq_corpus_0', label: 'O1', accessor: s => s.freq_corpus_0, isNumeric: true },
                          { key: 'percent_corpus_0', label: '%1', accessor: s => s.percent_corpus_0, isNumeric: true, formatter: v => formatNumber(v, 2, { suffix: '%' }) },
                          { key: 'freq_corpus_1', label: 'O2', accessor: s => s.freq_corpus_1, isNumeric: true },
                          { key: 'percent_corpus_1', label: '%2', accessor: s => s.percent_corpus_1, isNumeric: true, formatter: v => formatNumber(v, 2, { suffix: '%' }) },
                          { key: 'log_likelihood_llv', label: 'LL', accessor: s => s.log_likelihood_llv, isNumeric: true, formatter: v => formatNumber(v, 2) },
                          { key: 'percent_diff', label: '%DIFF', accessor: s => s.percent_diff, isNumeric: true, formatter: v => formatNumber(v, 2, { suffix: '%', multiplier: 100 }) },
                          { key: 'bayes_factor_bic', label: 'Bayes', accessor: s => s.bayes_factor_bic, isNumeric: true, formatter: v => formatNumber(v, 2) },
                          { key: 'effect_size_ell', label: 'ELL', accessor: s => s.effect_size_ell, isNumeric: true, formatter: v => formatNumber(v, 4, { fallback: 'N/A' }) },
                          { key: 'relative_risk', label: 'RRisk', accessor: s => s.relative_risk, isNumeric: true, formatter: v => formatNumber(v, 2, { fallback: '∞' }) },
                          { key: 'log_ratio', label: 'LogRatio', accessor: s => s.log_ratio, isNumeric: true, formatter: v => formatNumber(v, 4, { fallback: 'N/A' }) },
                          { key: 'odds_ratio', label: 'OddsRatio', accessor: s => s.odds_ratio, isNumeric: true, formatter: v => formatNumber(v, 2, { fallback: '∞' }) },
                          { key: 'significance', label: 'Significance', accessor: s => s.significance || '', formatter: (_: any, s: any) => (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              s.significance === '****' ? 'bg-red-100 text-red-800' :
                              s.significance === '***' ? 'bg-orange-100 text-orange-800' :
                              s.significance === '**' ? 'bg-yellow-100 text-yellow-800' :
                              s.significance === '*' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {s.significance || 'n.s.'}
                            </span>) }
                        ];

                        const handleSort = (col: string) => {
                          if (statsSortColumn === col) {
                            setStatsSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                          } else {
                            setStatsSortColumn(col);
                            setStatsSortDirection(col === 'token' ? 'asc' : 'desc');
                          }
                        };

                        const total = sortedStatistics.length;
                        const n = headTailN;
                        let display: any[] = [];
                        let truncated = false;
                        if (total <= n * 2) {
                          display = sortedStatistics; // no truncation
                        } else {
                          truncated = true;
                          const head = sortedStatistics.slice(0, n);
                          const tail = sortedStatistics.slice(total - n);
                          // Insert placeholder object to render a middle button instead of ellipsis
                          display = [...head, { __showAllButton: true, key: '__showAllButton' }, ...tail];
                        }

                        // We'll return the truncated table; full modal redefines its own columns
                        return (
                          <div className="overflow-x-auto">
                            <Table className="rounded-lg border border-border">
                              <TableHeader className="bg-gray-50">
                                <TableRow>
                                  {columns.map(col => {
                                    const active = statsSortColumn === col.key;
                                    const dir = active ? (statsSortDirection === 'asc' ? '▲' : '▼') : '';
                                    return (
                                      <TableHead
                                        key={col.key}
                                        className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100 ${active ? 'text-blue-600' : 'text-gray-500'}`}
                                        onClick={() => handleSort(col.key)}
                                      >
                                        <div className="flex items-center gap-1">
                                          <span>{col.label}</span>
                                          {dir && <span className="text-[10px]">{dir}</span>}
                                        </div>
                                      </TableHead>
                                    );
                                  })}
                                </TableRow>
                              </TableHeader>
                              <TableBody className="bg-white divide-y divide-gray-200">
                                {display.map((stat, index) => {
                                  if (stat.__showAllButton) {
                                    return (
                                      <TableRow key={`showall-${index}`}>
                                        <TableCell colSpan={columns.length} className="px-3 py-6">
                                          <div className="w-full flex items-center justify-center">
                                            <Button
                                              onClick={() => setShowFullStatsModal(true)}
                                            >
                                              <Table2 className="mr-2 h-4 w-4" />
                                              Show complete table ({total} rows)
                                            </Button>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  }
                                  return (
                                    <TableRow key={stat.token} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                      {columns.map(col => {
                                        const rawVal = col.accessor(stat);
                                        const content = col.formatter ? col.formatter(rawVal, stat) : rawVal;
                                        const cellClasses = `px-3 py-2 text-sm ${col.key === 'token' ? 'font-medium text-blue-600 cursor-pointer hover:text-blue-800 hover:bg-blue-50' : 'text-gray-900 font-mono text-center'} `;
                                        if (col.key === 'token') {
                                          return (
                                            <TableCell key={col.key} className={cellClasses} onClick={() => handleTokenClick(stat.token)}>
                                              {content}
                                            </TableCell>
                                          );
                                        }
                                        return (
                                          <TableCell key={col.key} className={cellClasses}>{content}</TableCell>
                                        );
                                      })}
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                            {truncated && (
                              <div className="text-xs text-gray-500 mt-2">Showing first {n} and last {n} of {total} rows. Click a header to toggle descending/ascending.</div>
                            )}
                          </div>
                        );
                      })()}
                      {showFullStatsModal && (() => {
                        // Rebuild columns with labels & formatters (duplicate of earlier definition to keep scope simple)
                        const columns = [
                          { key: 'token', label: 'Token', accessor: (s: any) => s.token },
                          { key: 'freq_corpus_0', label: 'O1', accessor: (s: any) => s.freq_corpus_0, formatter: (v: any) => formatNumber(v, 0) },
                          { key: 'percent_corpus_0', label: '%1', accessor: (s: any) => s.percent_corpus_0, formatter: (v: any) => formatNumber(v, 2, { suffix: '%' }) },
                          { key: 'freq_corpus_1', label: 'O2', accessor: (s: any) => s.freq_corpus_1, formatter: (v: any) => formatNumber(v, 0) },
                          { key: 'percent_corpus_1', label: '%2', accessor: (s: any) => s.percent_corpus_1, formatter: (v: any) => formatNumber(v, 2, { suffix: '%' }) },
                          { key: 'log_likelihood_llv', label: 'LL', accessor: (s: any) => s.log_likelihood_llv, formatter: (v: any) => formatNumber(v, 2) },
                          { key: 'percent_diff', label: '%DIFF', accessor: (s: any) => s.percent_diff, formatter: (v: any) => formatNumber(v, 2, { suffix: '%', multiplier: 100 }) },
                          { key: 'bayes_factor_bic', label: 'Bayes', accessor: (s: any) => s.bayes_factor_bic, formatter: (v: any) => formatNumber(v, 2) },
                          { key: 'effect_size_ell', label: 'ELL', accessor: (s: any) => s.effect_size_ell, formatter: (v: any) => formatNumber(v, 4, { fallback: 'N/A' }) },
                          { key: 'relative_risk', label: 'RRisk', accessor: (s: any) => s.relative_risk, formatter: (v: any) => formatNumber(v, 2, { fallback: '∞' }) },
                          { key: 'log_ratio', label: 'LogRatio', accessor: (s: any) => s.log_ratio, formatter: (v: any) => formatNumber(v, 4, { fallback: 'N/A' }) },
                          { key: 'odds_ratio', label: 'OddsRatio', accessor: (s: any) => s.odds_ratio, formatter: (v: any) => formatNumber(v, 2, { fallback: '∞' }) },
                          { key: 'significance', label: 'Significance', accessor: (s: any) => s.significance || '', formatter: (_: any, s: any) => (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              s.significance === '****' ? 'bg-red-100 text-red-800' :
                              s.significance === '***' ? 'bg-orange-100 text-orange-800' :
                              s.significance === '**' ? 'bg-yellow-100 text-yellow-800' :
                              s.significance === '*' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {s.significance || 'n.s.'}
                            </span>) }
                        ];
                        const modalSorted = sortedStatistics;

                        // Pagination over sorted rows (number_of_columns)
                        const totalRows = modalSorted.length;
                        const totalPages = Math.max(1, Math.ceil(totalRows / modalPageSize));
                        const currentPage = Math.min(modalPage, totalPages);
                        const startIndex = (currentPage - 1) * modalPageSize;
                        const pageRows = modalSorted.slice(startIndex, startIndex + modalPageSize);

                        // CSV download for full sorted table
                        const handleDownloadCSV = () => {
                          const headers = columns.map(c => c.label);
                          const csvEscape = (val: any) => {
                            const s = (val === null || val === undefined) ? '' : String(val);
                            const needsQuotes = /[",\n]/.test(s);
                            const escaped = s.replace(/"/g, '""');
                            return needsQuotes ? `"${escaped}"` : escaped;
                          };
              const toCSVVal = (colKey: string, stat: any) => {
                            switch (colKey) {
                              case 'token':
                                return stat.token;
                              case 'freq_corpus_0':
                                return formatNumber(stat.freq_corpus_0, 0, { fallback: '' });
                              case 'percent_corpus_0':
                                return formatNumber(stat.percent_corpus_0, 2, { suffix: '%', fallback: '' });
                              case 'freq_corpus_1':
                                return formatNumber(stat.freq_corpus_1, 0, { fallback: '' });
                              case 'percent_corpus_1':
                                return formatNumber(stat.percent_corpus_1, 2, { suffix: '%', fallback: '' });
                              case 'log_likelihood_llv':
                                return formatNumber(stat.log_likelihood_llv, 2, { fallback: '' });
                              case 'percent_diff':
                                return formatNumber(stat.percent_diff, 2, { suffix: '%', multiplier: 100, fallback: '' });
                              case 'bayes_factor_bic':
                                return formatNumber(stat.bayes_factor_bic, 2, { fallback: '' });
                              case 'effect_size_ell':
                                return formatNumber(stat.effect_size_ell, 4, { fallback: '' });
                              case 'relative_risk':
                                return formatNumber(stat.relative_risk, 2, { fallback: 'inf' });
                              case 'log_ratio':
                                return formatNumber(stat.log_ratio, 4, { fallback: '' });
                              case 'odds_ratio':
                                return formatNumber(stat.odds_ratio, 2, { fallback: 'inf' });
                              case 'significance':
                                return stat.significance || 'n.s.';
                              default:
                                return '';
                            }
                          };
                          const rows = modalSorted.map(stat => columns.map(c => csvEscape(toCSVVal(c.key, stat))).join(','));
                          const csv = [headers.join(','), ...rows].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          const ts = new Date().toISOString().replace(/[:.]/g, '-');
                          link.href = url;
                          link.download = `token_frequency_table_${ts}.csv`;
                          link.click();
                          URL.revokeObjectURL(url);
                        };
                        return (
                          <div className="fixed inset-0 z-50 flex items-center justify-center">
                            <div className="absolute inset-0 bg-black/40" onClick={() => setShowFullStatsModal(false)}></div>
                            <div className="relative bg-white rounded-lg shadow-xl max-w-[95vw] max-h-[90vh] w-full p-6 flex flex-col">
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                  <h4 className="text-lg font-semibold text-gray-800">Complete Statistical Table ({modalSorted.length} rows)</h4>
                                  <label className="text-sm text-gray-600 flex items-center gap-2">
                                    <span className="font-mono">number_of_columns</span>
                                    <select
                                      className="border rounded px-2 py-1 text-sm"
                                      value={modalPageSize}
                                      onChange={(e) => { setModalPageSize(parseInt(e.target.value, 10)); setModalPage(1); }}
                                    >
                                      <option value={10}>10</option>
                                      <option value={20}>20</option>
                                      <option value={50}>50</option>
                                      <option value={100}>100</option>
                                      <option value={200}>200</option>
                                    </select>
                                  </label>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    onClick={handleDownloadCSV}
                                    size="sm"
                                  >
                                    <Download className="mr-2 h-4 w-4" />
                                    Download CSV
                                  </Button>
                                  <Button
                                    onClick={() => setShowFullStatsModal(false)}
                                    variant="outline"
                                    size="sm"
                                  >
                                    <X className="mr-2 h-4 w-4" />
                                    Close
                                  </Button>
                                </div>
                              </div>
                              <div className="overflow-auto rounded border border-border">
                                <Table className="text-sm">
                                  <TableHeader className="bg-gray-50">
                                    <TableRow>
                                      {columns.map((col: any) => {
                                        const active = statsSortColumn === col.key;
                                        const dir = active ? (statsSortDirection === 'asc' ? '▲' : '▼') : '';
                                        return (
                                          <TableHead
                                            key={col.key}
                                            className={`px-3 py-2 text-left font-medium uppercase tracking-wider cursor-pointer select-none whitespace-nowrap ${active ? 'text-blue-600' : 'text-gray-500'} hover:bg-gray-100`}
                                            onClick={() => {
                                              if (statsSortColumn === col.key) {
                                                setStatsSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                                              } else {
                                                setStatsSortColumn(col.key);
                                                setStatsSortDirection(col.key === 'token' ? 'asc' : 'desc');
                                              }
                                              setModalPage(1);
                                            }}
                                          >
                                            <div className="flex items-center gap-1"><span>{col.label}</span>{dir && <span className="text-[10px]">{dir}</span>}</div>
                                          </TableHead>
                                        );
                                      })}
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody className="divide-y divide-gray-100">
                                    {pageRows.map((stat, i) => (
                                      <TableRow key={stat.token + i} className={((startIndex + i) % 2 === 0) ? 'bg-white' : 'bg-gray-50'}>
                                        {columns.map((col: any) => {
                                          const rawVal = col.accessor(stat);
                                          const content = col.formatter ? col.formatter(rawVal, stat) : rawVal;
                                          const cellClasses = `px-3 py-1.5 ${col.key === 'token' ? 'font-medium text-blue-600 cursor-pointer hover:text-blue-800 hover:bg-blue-50' : 'font-mono text-gray-900 text-center'} whitespace-nowrap`;
                                          if (col.key === 'token') {
                                            return <TableCell key={col.key} className={cellClasses} onClick={() => handleTokenClick(stat.token)}>{content}</TableCell>;
                                          }
                                          return <TableCell key={col.key} className={cellClasses}>{content}</TableCell>;
                                        })}
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                              <div className="mt-3 flex items-center justify-between">
                                <div className="text-xs text-gray-500">Click headers to sort; table updates live.</div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => currentPage > 1 && setModalPage(currentPage - 1)}
                                    disabled={currentPage <= 1}
                                  >
                                    <ChevronLeft className="h-4 w-4" />
                                  </Button>
                                  <span className="text-xs text-gray-700">Page {currentPage} of {totalPages}</span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => currentPage < totalPages && setModalPage(currentPage + 1)}
                                    disabled={currentPage >= totalPages}
                                  >
                                    <ChevronRight className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      
                      {(filteredStatistics.length === 0) && (
                        <div className="text-center py-8 text-gray-500">
                          No significant differences found between the selected datasets.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-muted bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                  No data available.
                </div>
              )}
              </>
          </CardContent>
        </Card>
      )}

      {results?.state === 'failed' && (
        <Card>
          <CardContent>
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {results?.message ?? 'The analysis failed. Please try again.'}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading.graph && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-600 mt-2">Loading workspace...</p>
        </div>
      )}

    </div>
  );
};

export default TokenFrequencyFeature;
