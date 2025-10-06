/* eslint-disable @typescript-eslint/no-explicit-any, react/no-unescaped-entities */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import NodeSelectionPanel from '../NodeSelectionPanel';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
import { nodesApi } from '../../api/nodes';
import { useAuth } from '../../hooks/useAuth';
import { TokenFrequencyRequest, TokenFrequencyResponse, textApi } from '../../api/text';
import { createConcordanceSeedRequest, resolveTokenFrequencyNodeContext, type TokenFrequencyAnalysisParams } from './tokenFrequencyHelpers';
import { Wordcloud } from '@visx/wordcloud';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Play, Loader2, Trash2, Table2, Download, X, ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { Text } from '@visx/text';
import useAutoNodeColumns, { type NodeColumnSelection } from '../../hooks/useAutoNodeColumns';
import useNodeColumnInfos from '../../hooks/useNodeColumnInfos';
import { useUIStore } from '../../stores';
import { useAnalysisStore } from '../../stores/analysisStore';

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

type FormatNumberOptions = {
  suffix?: string;
  multiplier?: number;
  fallback?: string;
};

const formatNumber = (value: unknown, decimals: number, options: FormatNumberOptions = {}): string => {
  const { suffix = '', multiplier = 1, fallback = '—' } = options;
  const numeric = toFiniteNumber(value);
  if (numeric === null) return fallback;
  const scaled = numeric * multiplier;
  if (!Number.isFinite(scaled)) return fallback;
  const formatted = scaled.toFixed(decimals);
  const sanitized = /^-0(?:\.0+)?$/.test(formatted) ? formatted.replace('-', '') : formatted;
  return `${sanitized}${suffix}`;
};

const DEFAULT_TOKEN_LIMIT = 10;
const SERVER_LIMIT_MULTIPLIER = 5;
const MAX_SERVER_TOKEN_LIMIT = 5000;

const computeServerLimit = (limit: number) =>
  Math.min(Math.max(limit * SERVER_LIMIT_MULTIPLIER, DEFAULT_TOKEN_LIMIT), MAX_SERVER_TOKEN_LIMIT);

const TokenFrequencyTab: React.FC = () => {
  const { selectedNodes } = useWorkspaceSelection();
  const { currentWorkspaceId, getNodeShape } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const nodeIdToName = useMemo(() => {
    const map: Record<string,string> = {};
    selectedNodes.forEach(n => {
      const name = (n.name || n.data?.name || (n as any).label || n.data?.label || n.data?.nodeName || n.id);
      map[n.id] = String(name);
    });
    return map;
  }, [selectedNodes]);

  const { getAuthHeaders } = useAuth();
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const setPendingConcordance = useAnalysisStore((state) => state.setPendingConcordance);

  const [stopWords, setStopWords] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  // Shared auto column selection hook (shared scope with Concordance via undefined storageScope)
  const { selections: nodeColumnSelections, setSelection: setNodeColumnSelection, setSelections: setNodeColumnSelectionsRaw, recompute: recomputeAutoColumns } = useAutoNodeColumns({
    selectedNodes,
    getNodeColumns: getColumnInfos,
    allowedDataTypes: ['string'],
  }, { workspaceId: currentWorkspaceId, maxNodes: 2, isLocked, docTypeOnly: true, enableHeuristicGuess: false });
  const [lockedNodesSnapshot, setLockedNodesSnapshot] = useState<Array<{ id: string; name: string; columns: string[] }>>([]);
  const lockedNodeNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    lockedNodesSnapshot.forEach(({ id, name }) => {
      map[id] = name;
    });
    return map;
  }, [lockedNodesSnapshot]);
  const [isLoadingStopWords, setIsLoadingStopWords] = useState(false);
  const [results, setResults] = useState<TokenFrequencyResponse | null>(null);
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
  const [nodeColors, setNodeColors] = useState<Record<string, string>>({});
  const [lastCompareNodeIds, setLastCompareNodeIds] = useState<string[]>([]); // preserves order used in last analysis
  // Locally-applied stop word filter (no recomputation)
  const [appliedStopSet, setAppliedStopSet] = useState<Set<string>>(new Set());
  const [tokenLimitOverride, setTokenLimitOverride] = useState<number | null>(null);
  const [tokenLimitInput, setTokenLimitInput] = useState<string>('');
  const [tokenLimitError, setTokenLimitError] = useState<string | null>(null);
  const [isApplyingTokenLimit, setIsApplyingTokenLimit] = useState(false);
  const previousBackendLimitRef = useRef<number | null>(null);
  const tokenLimitInputChangedRef = useRef(false);
  const tokenLimitApplyTimeoutRef = useRef<number | null>(null);

  const backendTokenLimit = useMemo(() => {
    if (!results) return null;
    const r = results as any;
    const params = r?.analysis_params ?? {};
    const metadata = r?.metadata ?? {};
    const candidates = [
      r?.token_limit,
      params?.token_limit,
      metadata?.token_limit,
      r?.limit,
      params?.limit,
      metadata?.limit,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
    }
    return null;
  }, [results]);
  useEffect(() => {
    const backendLimit = (typeof backendTokenLimit === 'number' && Number.isFinite(backendTokenLimit))
      ? backendTokenLimit
      : null;
    if (backendLimit !== null) {
      if (previousBackendLimitRef.current !== backendLimit || tokenLimitOverride !== backendLimit) {
        if (typeof window !== 'undefined' && tokenLimitApplyTimeoutRef.current !== null) {
          window.clearTimeout(tokenLimitApplyTimeoutRef.current);
          tokenLimitApplyTimeoutRef.current = null;
        }
        tokenLimitInputChangedRef.current = false;
        setTokenLimitOverride(backendLimit);
        setTokenLimitInput(String(backendLimit));
        setTokenLimitError(null);
      }
      previousBackendLimitRef.current = backendLimit;
    } else if (tokenLimitOverride === null) {
      if (typeof window !== 'undefined' && tokenLimitApplyTimeoutRef.current !== null) {
        window.clearTimeout(tokenLimitApplyTimeoutRef.current);
        tokenLimitApplyTimeoutRef.current = null;
      }
      tokenLimitInputChangedRef.current = false;
      setTokenLimitOverride(DEFAULT_TOKEN_LIMIT);
      setTokenLimitInput(String(DEFAULT_TOKEN_LIMIT));
    }
  }, [backendTokenLimit, tokenLimitOverride]);

  const backendStopWords = useMemo(() => {
    if (!results) return null;
    const payload = results as any;
    const candidates = [
      Array.isArray(payload?.stop_words) ? payload.stop_words : null,
      Array.isArray(payload?.metadata?.stop_words) ? payload.metadata.stop_words : null,
      Array.isArray(payload?.analysis_params?.stop_words) ? payload.analysis_params.stop_words : null,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.map((item: any) => String(item));
      }
    }
    return null;
  }, [results]);

  useEffect(() => {
    if (!results) {
      setStopWords('');
      setAppliedStopSet(new Set());
      return;
    }
    const stops = Array.isArray(backendStopWords) ? backendStopWords : [];
    const normalized = stops
      .map((w) => String(w).trim().toLowerCase())
      .filter((w) => w.length > 0);
    const joined = normalized.join(', ');
    setStopWords(joined);
    setAppliedStopSet(new Set(normalized));
  }, [backendStopWords, results]);

  const effectiveTokenLimit = useMemo(() => {
    if (typeof tokenLimitOverride === 'number' && Number.isFinite(tokenLimitOverride)) {
      return tokenLimitOverride;
    }
    if (typeof backendTokenLimit === 'number' && Number.isFinite(backendTokenLimit)) {
      return backendTokenLimit;
    }
    return DEFAULT_TOKEN_LIMIT;
  }, [tokenLimitOverride, backendTokenLimit]);

  const persistTokenPreferences = useCallback(
    async (partial: { token_limit?: number; stop_words?: string[] }) => {
      if (!currentWorkspaceId) return;
      const payload: Record<string, any> = {};
      if (partial.token_limit !== undefined) {
        payload.token_limit = partial.token_limit;
      }
      if (partial.stop_words !== undefined) {
        payload.stop_words = partial.stop_words;
      }
      if (Object.keys(payload).length === 0) return;
      await textApi.postTokenFrequenciesCurrentResult(
        currentWorkspaceId,
        payload,
        getAuthHeaders()
      );
    },
    [currentWorkspaceId, getAuthHeaders]
  );

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
          const normalizedLimit = Math.max(1, Math.floor(nextTokenLimit));
          const serverLimit = computeServerLimit(normalizedLimit);
          metadata.token_limit = normalizedLimit;
          metadata.server_limit = serverLimit;
          analysisParams.token_limit = normalizedLimit;
          analysisParams.server_limit = serverLimit;
          nextTokenLimit = normalizedLimit;
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
    if (typeof window !== 'undefined' && tokenLimitApplyTimeoutRef.current !== null) {
      window.clearTimeout(tokenLimitApplyTimeoutRef.current);
      tokenLimitApplyTimeoutRef.current = null;
    }
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
    if (normalized === effectiveTokenLimit) {
      setTokenLimitError(null);
      return;
    }

    setTokenLimitError(null);
    setIsApplyingTokenLimit(true);
    try {
      if (results) {
        await persistTokenPreferences({ token_limit: normalized });
        updateResultsPreferencesLocally({ tokenLimit: normalized });
      }
      setTokenLimitOverride(normalized);
      setTokenLimitInput(String(normalized));
      previousBackendLimitRef.current = normalized;
    } catch (error) {
      console.error('Failed to update token limit', error);
      setTokenLimitError('Failed to update token limit. Please try again.');
    } finally {
      setIsApplyingTokenLimit(false);
    }
  }, [tokenLimitInput, effectiveTokenLimit, results, persistTokenPreferences, updateResultsPreferencesLocally]);

  useEffect(() => {
    if (!tokenLimitInputChangedRef.current) return;
    if (typeof window === 'undefined') return;

    if (tokenLimitApplyTimeoutRef.current !== null) {
      window.clearTimeout(tokenLimitApplyTimeoutRef.current);
      tokenLimitApplyTimeoutRef.current = null;
    }

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

    setTokenLimitError(null);
    tokenLimitApplyTimeoutRef.current = window.setTimeout(() => {
      void applyTokenLimitWithValidation();
    }, 600);

    return () => {
      if (tokenLimitApplyTimeoutRef.current !== null) {
        window.clearTimeout(tokenLimitApplyTimeoutRef.current);
        tokenLimitApplyTimeoutRef.current = null;
      }
    };
  }, [tokenLimitInput, applyTokenLimitWithValidation]);

  // Helper to compute and apply stop set from a comma-separated string
  const saveStopWordsToBackend = useCallback(
    async (words: string[]) => {
      if (!results) return;
      try {
        await persistTokenPreferences({ stop_words: words });
        updateResultsPreferencesLocally({ stopWords: words });
      } catch (e) {
        if (localStorage.getItem('debugTF') === '1') console.warn('Failed to save stop words', e);
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
    if (typeof window !== 'undefined' && tokenLimitApplyTimeoutRef.current !== null) {
      window.clearTimeout(tokenLimitApplyTimeoutRef.current);
      tokenLimitApplyTimeoutRef.current = null;
    }
    tokenLimitInputChangedRef.current = true;
    setTokenLimitInput(event.target.value);
    if (tokenLimitError) setTokenLimitError(null);
  };

  const handleTokenLimitBlur = () => {
    if (typeof window !== 'undefined' && tokenLimitApplyTimeoutRef.current !== null) {
      window.clearTimeout(tokenLimitApplyTimeoutRef.current);
      tokenLimitApplyTimeoutRef.current = null;
    }
    void applyTokenLimitWithValidation();
  };

  const handleTokenLimitKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (typeof window !== 'undefined' && tokenLimitApplyTimeoutRef.current !== null) {
        window.clearTimeout(tokenLimitApplyTimeoutRef.current);
        tokenLimitApplyTimeoutRef.current = null;
      }
      void applyTokenLimitWithValidation();
    }
  };
  const defaultPalette = useMemo(
    () => [
      '#2563eb', // vivid blue
      '#dc2626', // vivid red
      '#16a34a', // green
      '#9333ea', // purple
      '#0d9488', // teal
      '#db2777', // pink
      '#4f46e5', // indigo
      '#65a30d', // lime
      '#0891b2', // cyan
      '#92400e', // brown
      '#6b7280', // gray
    ],
    []
  );
  // Color picker handled by shared component now

  // Ensure every currently selected node has a color
  useEffect(() => {
    if (!selectedNodes.length) return;
    setNodeColors(prev => {
      const updated = { ...prev };
      let paletteIndex = 0;
      selectedNodes.forEach(n => {
        if (!updated[n.id]) {
          // find first palette color not already used (simple pass)
          while (Object.values(updated).includes(defaultPalette[paletteIndex % defaultPalette.length]) && paletteIndex < defaultPalette.length * 2) {
            paletteIndex++;
          }
          updated[n.id] = defaultPalette[paletteIndex % defaultPalette.length];
          paletteIndex++;
        }
      });
      return updated;
    });
  }, [selectedNodes, defaultPalette]);

  const handleColorChange = (nodeId: string, color: string) => {
    setNodeColors(prev => ({ ...prev, [nodeId]: color }));
  };

  // Removed legacy popover logic

  // Hydrate from backend on mount and whenever the tab becomes visible again or we lack statistics
  const hydratingRef = useRef<boolean>(false);
  const performHydration = useCallback(async () => {
    if (hydratingRef.current) return;
    if (!currentWorkspaceId) return;
    hydratingRef.current = true;
    try {
      let fallbackStopWords: string[] = [];
      const reqResp = await textApi.getTokenFrequenciesCurrentRequest(currentWorkspaceId, getAuthHeaders());
      if (!reqResp) {
        // No current request: clear local persisted state and DO NOT fetch current-result
        setStopWords('');
        setAppliedStopSet(new Set());
        setNodeColumnSelectionsRaw([], { replace: true });
        setLastCompareNodeIds([]);
        setTokenLimitOverride(DEFAULT_TOKEN_LIMIT);
        setTokenLimitInput(String(DEFAULT_TOKEN_LIMIT));
        setTokenLimitError(null);
        tokenLimitInputChangedRef.current = false;
        if (typeof window !== 'undefined' && tokenLimitApplyTimeoutRef.current !== null) {
          window.clearTimeout(tokenLimitApplyTimeoutRef.current);
          tokenLimitApplyTimeoutRef.current = null;
        }
        return;
      }
      const req = (reqResp as any)?.data;
      if (req) {
        if (Array.isArray(req.stop_words)) {
          fallbackStopWords = req.stop_words
            .map((w: any) => String(w).trim().toLowerCase())
            .filter((w: string) => w.length > 0);
        }
        const nodeIds: string[] = Array.isArray(req.node_ids)
          ? req.node_ids.slice(0, 2)
          : [];
        const nodeColumnsMap: Record<string, string> =
          req.node_columns && typeof req.node_columns === 'object' ? req.node_columns : {};
        const selections = nodeIds.map((id: string) => ({
          nodeId: id,
          column: nodeColumnsMap[id] || '',
        }));
        setNodeColumnSelectionsRaw(selections, { replace: true });
        setLastCompareNodeIds(nodeIds);
        const limitFromRequest = toFiniteNumber(
          (req as any).token_limit ?? (req as any).limit
        );
        if (limitFromRequest !== null && limitFromRequest > 0) {
          const normalizedLimit = Math.floor(limitFromRequest);
          setTokenLimitOverride(normalizedLimit);
          setTokenLimitInput(String(normalizedLimit));
          tokenLimitInputChangedRef.current = false;
          if (typeof window !== 'undefined' && tokenLimitApplyTimeoutRef.current !== null) {
            window.clearTimeout(tokenLimitApplyTimeoutRef.current);
            tokenLimitApplyTimeoutRef.current = null;
          }
        }
        try {
          const snaps: Array<{ id: string; name: string; columns: string[] }> = [];
          for (const id of nodeIds) {
            try {
              const info = await nodesApi.info(currentWorkspaceId!, id, getAuthHeaders());
              const name = (info as any)?.name || (info as any)?.data?.name || id;
              const columns = Array.isArray((info as any)?.columns) ? (info as any).columns : (Array.isArray((info as any)?.data?.columns) ? (info as any).data.columns : []);
              snaps.push({ id, name: String(name), columns });
            } catch {
              snaps.push({ id, name: id, columns: [] });
            }
          }
          if (snaps.length) {
            setLockedNodesSnapshot(snaps);
            setIsLocked(true);
          }
        } catch { /* ignore */ }
      }
      // Only fetch current-result if a request existed
      const resResp = await textApi.getTokenFrequenciesCurrentResult(currentWorkspaceId, getAuthHeaders());
      if (resResp) {
        setResults(resResp as any);
      } else {
        setStopWords(fallbackStopWords.join(', '));
        setAppliedStopSet(new Set(fallbackStopWords));
      }
    } catch { /* ignore */ }
    finally {
      hydratingRef.current = false;
    }
  }, [
    currentWorkspaceId,
    getAuthHeaders,
    setStopWords,
    setAppliedStopSet,
    setNodeColumnSelectionsRaw,
    setLastCompareNodeIds,
    setTokenLimitOverride,
    setTokenLimitInput,
    setTokenLimitError,
    setLockedNodesSnapshot,
    setIsLocked,
    setResults,
  ]);
  useEffect(() => { void performHydration(); }, [performHydration]);
  useEffect(() => {
    const handleVisibility = () => {
      const shouldRehydrate = document.visibilityState === 'visible' && currentWorkspaceId && (!results || (Array.isArray(results.statistics) && results.statistics.length === 0 && lastCompareNodeIds.length === 2));
      if (shouldRehydrate) void performHydration();
    };
    window.addEventListener('focus', handleVisibility);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleVisibility);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [results, currentWorkspaceId, lastCompareNodeIds, performHydration]);


  // Debug results changes
  useEffect(() => {
      if (results) {
      if (localStorage.getItem('debugTF') === '1') {
        console.debug('Results updated:', results);
        console.debug('Results state:', (results as any).state);
        console.debug('Results data:', results.data);
      }
      if (results.data) {
        if (localStorage.getItem('debugTF') === '1') console.debug('Data entries:', Object.entries(results.data));
      }
    }
  }, [results]);

  // Reset modal page when sort/filter state changes or modal opens
  useEffect(() => {
    if (showFullStatsModal) {
      setModalPage(1);
    }
  }, [showFullStatsModal, statsSortColumn, statsSortDirection, appliedStopSet]);

  // Clear results when node selection changes  
  // Use a more stable dependency by checking the actual node IDs
  const selectedNodeIds = useMemo(() => selectedNodes.map(node => node.id).sort(), [selectedNodes]);
  useEffect(() => {
    if (!isLocked) setResults(null);
  }, [selectedNodeIds, isLocked]);

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
    if (response.state === 'successful' && response.data) {
        const joined = response.data.join(', ');
        setStopWords(joined);
        // Auto-apply on fill default and persist
        applyStopSetFromText(joined);
      } else {
        console.error('Failed to get default stop words:', response.message);
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

    const incompleteSelections = nodeColumnSelections.filter(sel => !sel.column);
    if (incompleteSelections.length > 0) {
      alert('Please select a text column for all selected nodes.');
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
      nodeColumnSelections.forEach(sel => {
        if (sel.column) nodeColumns[sel.nodeId] = sel.column;
      });

      const request: TokenFrequencyRequest = {
        node_ids: selectedNodes.slice(0, 2).map(node => node.id),
        node_columns: nodeColumns,
        stop_words: stopWordsArray,
      };

      const response = await textApi.tokenFrequencies(currentWorkspaceId, request, getAuthHeaders());

      if (localStorage.getItem('debugTF') === '1') console.debug('Token Frequency Response:', response);
      setResults(response);
      setLastCompareNodeIds(request.node_ids);

      if (Array.isArray(response.stop_words)) {
        const normalizedStops = response.stop_words
          .map((word: string) => String(word).trim().toLowerCase())
          .filter(Boolean);
        setAppliedStopSet(new Set(normalizedStops));
        setStopWords(normalizedStops.join(', '));
      }

      try {
        const snaps: Array<{ id: string; name: string; columns: string[] }> = [];
        for (const id of request.node_ids) {
          try {
            const info = await nodesApi.info(currentWorkspaceId!, id, getAuthHeaders());
            const name = (info as any)?.name || (info as any)?.data?.name || id;
            const columns = Array.isArray((info as any)?.columns)
              ? (info as any).columns
              : Array.isArray((info as any)?.data?.columns)
              ? (info as any).data.columns
              : [];
            snaps.push({ id, name: String(name), columns });
          } catch {
            snaps.push({ id, name: id, columns: [] });
          }
        }
        if (snaps.length) {
          setLockedNodesSnapshot(snaps);
          setIsLocked(true);
        }
      } catch {
        /* ignore */
      }
    } catch (error) {
      console.error('Error calculating token frequencies:', error);
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
    try {
      if (currentWorkspaceId) {
        await textApi.clearTokenFrequencies(currentWorkspaceId, getAuthHeaders());
      }
    } catch (e) {
      console.error('Failed to clear backend analyses/cache:', e);
    }
    setResults(null);
    setLastCompareNodeIds([]);
    setLockedNodesSnapshot([]);
    setIsLocked(false);
    setTokenLimitError(null);
    tokenLimitInputChangedRef.current = false;
    if (typeof window !== 'undefined' && tokenLimitApplyTimeoutRef.current !== null) {
      window.clearTimeout(tokenLimitApplyTimeoutRef.current);
      tokenLimitApplyTimeoutRef.current = null;
    }
  };

  const handleTokenClick = async (token: string) => {
    const workspaceId = currentWorkspaceId;
    const trimmedToken = token?.toString() ?? '';
    const analysisParams = (results?.analysis_params ?? null) as TokenFrequencyAnalysisParams | null;

    const resolvedContext = resolveTokenFrequencyNodeContext({
      lastCompareNodeIds,
      analysisParams,
      selectedNodes: selectedNodes.map((node) => ({ id: node.id })),
      nodeColumnSelections,
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
      : nodeColumnSelections.filter((sel) => fallbackNodeIds.includes(sel.nodeId) && sel.column);

    const uniqueNodeIds: string[] = fallbackNodeIds
      .filter((id, index, arr) => arr.indexOf(id) === index)
      .slice(0, 2);

    const effectiveSelections: NodeColumnSelection[] = fallbackSelections.filter((sel) =>
      uniqueNodeIds.includes(sel.nodeId)
    );

    const request = createConcordanceSeedRequest(trimmedToken, {
      selectedNodes: uniqueNodeIds.map((id) => ({ id })),
      nodeColumnSelections: effectiveSelections,
      maxNodes: 2,
      numLeftTokens: 10,
      numRightTokens: 10,
      combined: false,
    });

    try {
      if (workspaceId && request) {
        await textApi.concordance(workspaceId, request, getAuthHeaders());
      }
    } catch (e) {
      if (localStorage.getItem('debugTF') === '1') console.warn('Pre-trigger concordance failed:', e);
    }

    const nodeDetails = uniqueNodeIds.map((id) => ({
      id,
      name: lockedNodeNameMap[id] || nodeIdToName[id] || id,
    }));

    const pendingNodeColors: Record<string, string> = { ...nodeColors };
    uniqueNodeIds.forEach((id, idx) => {
      if (!pendingNodeColors[id]) {
        pendingNodeColors[id] = defaultPalette[idx % defaultPalette.length];
      }
    });

    setPendingConcordance({
      searchWord: trimmedToken,
      nodeColumnSelections: effectiveSelections.map((sel) => ({ ...sel })),
      selectedNodes: nodeDetails,
      nodeColors: pendingNodeColors,
      autoRun: true,
      timestamp: Date.now(),
    });

    setCurrentView('concordance');

    if (localStorage.getItem('debugTF') === '1') {
      console.debug(
        `Navigating to concordance with token: "${trimmedToken}" via store (nodes=${uniqueNodeIds.join(', ') || '∅'})`
      );
    }
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

  const getColorForNodeId = (nodeId: string, idx: number) => nodeColors[nodeId] || defaultPalette[idx % defaultPalette.length];

  const renderWordCloud = (data: any[], width: number = 400, height: number = 200, color: string) => {
    // Transform data for word cloud format
    const words = data.map(item => ({
      text: item.token,
      value: item.frequency
    }));

    const fontScale = (datum: any) => Math.max(12, Math.min(48, datum.value / Math.max(...data.map(d => d.frequency)) * 36 + 12));
    const fontSizeSetter = (datum: any) => fontScale(datum);

    return (
      <div className="flex justify-center mb-4">
        <svg width={width} height={height}>
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
  const filteredResultsData = useMemo(() => {
    if (!results?.data) return null;
    if (!appliedStopSet || appliedStopSet.size === 0) return results.data as any;
    const out: Record<string, any[]> = {};
    for (const [nodeName, freqValue] of Object.entries(results.data as any)) {
      const rows = Array.isArray(freqValue) ? (freqValue as any[]) : ((freqValue as any)?.data ?? []);
      out[nodeName] = rows.filter((item: any) => !appliedStopSet.has(String(item.token || '').toLowerCase()));
    }
    return out;
  }, [results, appliedStopSet]);

  const renderChart = (nodeName: string, data: any[], color: string) => {
    // Find max frequency for bar width calculation (guard against empty arrays)
    const maxFreq = Math.max(...data.map(item => item.frequency), 1);

    return (
      <div key={nodeName} className="mb-6">
        <div className="h-16 mb-4 flex items-center">
          <h3 className="text-lg font-semibold text-gray-800 break-words leading-tight w-full">{nodeName}</h3>
        </div>
        
  {/* Word Cloud */}
  {renderWordCloud(data, 400, 200, color)}
        
        <div className="bg-white p-4 rounded-lg border">
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
              <CardTitle>Token Frequency Analysis</CardTitle>
              <CardDescription>Inspect token usage and comparative statistics for selected nodes.</CardDescription>
            </div>
{isLocked && (
              <div className="relative group flex items-center text-sm text-muted-foreground">
                <svg className="mr-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M5 8V6a5 5 0 1110 0v2h1a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1h1zm2-2a3 3 0 116 0v2H7V6zm-2 4h10v7H5v-7z" clipRule="evenodd" />
                </svg>
                Locked
                <div className="absolute right-0 top-full z-10 mt-2 hidden w-72 rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg group-hover:block">
                  <div className="mb-1 font-semibold">Panel locked</div>
                  <ul className="ml-4 space-y-1 list-disc">
                    <li>Locked to current request/results.</li>
                    <li>Node selection and backend-used parameters are disabled.</li>
                    <li>Stop words remain editable; token limit now comes from backend results.</li>
                    <li>Clear results to unlock and resync with the graph selection.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <NodeSelectionPanel
            selectedNodes={(isLocked && lockedNodesSnapshot.length)
              ? lockedNodesSnapshot.map((s) => ({
                  id: s.id,
                  name: s.name,
                  data: { name: s.name, nodeName: s.name, label: s.name, columns: s.columns },
                  columns: s.columns,
                }))
              : selectedNodes}
            nodeColumnSelections={nodeColumnSelections}
            onColumnChange={handleColumnChange}
            nodeColors={nodeColors}
            onColorChange={handleColorChange}
            defaultPalette={defaultPalette}
            maxCompare={2}
            className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
            showShape
            getNodeShapeFn={getNodeShape}
            disabled={!!isLocked}
            showColorPicker={true}
            getNodeColumns={getColumnInfos}
            allowedDataTypes={['string']}
          />

        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-3 pt-0">
          <Button
            onClick={handleAnalyze}
            disabled={
              selectedNodes.length === 0 ||
              isAnalyzing ||
              !currentWorkspaceId ||
              nodeColumnSelections.some(sel => !sel.column) ||
              !!isLocked
            }
            className="w-full md:w-auto"
          >
            {isAnalyzing ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing...</>
            ) : (
              <><Play className="mr-2 h-4 w-4" />Calculate Token Frequencies</>
            )}
          </Button>
          {results && (
            <Button
              onClick={handleClearResults}
              variant="destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Results
            </Button>
          )}
          {appliedStopSet.size > 0 && (
            <span className="text-xs text-muted-foreground">Active filter: {appliedStopSet.size} word{appliedStopSet.size === 1 ? '' : 's'}</span>
          )}
        </CardFooter>

      </Card>

      {/* Results */}
      {results && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Token Frequency Results</CardTitle>
            {results.message && (
              <CardDescription className="text-sm text-muted-foreground">
                {results.message}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {(results as any).state === 'successful' ? (
              <>
                <div className="rounded-md border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-5 w-5 flex-shrink-0" />
                    <div>
                      <strong>Tip:</strong> Click any token below to open the Concordance tab preloaded with the same node selections.
                    </div>
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-4">
                  <div className="flex flex-col gap-2">
                    <span className="uppercase tracking-wide text-[10px] font-semibold text-foreground/80">Number of tokens to show</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Number of tokens to show"
                        type="number"
                        min={1}
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
                      {tokenLimitError ?? 'Enter a positive whole number.'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="uppercase tracking-wide text-[10px] font-semibold text-foreground/80">Stop words (comma-separated)</span>
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

              {results.data ? (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {Object.entries((filteredResultsData ?? (results.data as any))).map(([nodeName, freqValue], idx) => {
                      const nodeId = lastCompareNodeIds[idx];
                      const color = getColorForNodeId(nodeId, idx);
                      const rows = Array.isArray(freqValue) ? (freqValue as any[]) : ((freqValue as any)?.data ?? []);
                      // Cap to backend-provided limit after filtering to maintain a stable count
                      const limitForSlice = typeof effectiveTokenLimit === 'number' ? effectiveTokenLimit : rows.length;
                      const display = rows.slice(0, Math.max(0, limitForSlice));
                      return renderChart(nodeName, display, color);
                    })}
                  </div>

                  {/* Unified Comparative Word Cloud */}
                  {Object.keys(results.data).length === 2 && lastCompareNodeIds.length === 2 && (() => {
                    const entries = Object.entries(results.data);
                    const [nodeAName] = entries[0];
                    const [nodeBName] = entries[1];
                    const nodeAId = lastCompareNodeIds[0];
                    const nodeBId = lastCompareNodeIds[1];
                    const nodeAColor = getColorForNodeId(nodeAId, 0);
                    const nodeBColor = getColorForNodeId(nodeBId, 1);
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

                    // // Debug print of selected tokens with juxRank
                    // const debugOn = (typeof window !== 'undefined') && localStorage.getItem('debugTF') === '1';
                    // if (debugOn) {
                    //   const dbg = [...selected]
                    //     .sort((a, b) => a.juxRank - b.juxRank)
                    //     .map(s => ({ token: s.token, juxRank: Number.isFinite(s.juxRank) ? Number(s.juxRank.toFixed(6)) : s.juxRank, O1: s.o1, O2: s.o2, LogRatio: Number(s.logratio.toFixed(6)) }));
                    //   // eslint-disable-next-line no-console
                    //   console.log('Unified Word Cloud selected tokens (by juxRank low→high):', dbg);
                    // }

                    const maxTotal = Math.max(...selected.map(w => w.total));

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

                    return (
                      <div className="mb-10">
                        <div className="flex items-center justify-between mb-3 flex-wrap gap-4">
                          <h3 className="text-lg font-semibold text-gray-800">Unified Word Cloud</h3>
                          <div className="flex items-center space-x-4 text-sm">
                            <div className="flex items-center space-x-1"><span className="w-4 h-4 inline-block rounded" style={{ background: nodeAColor }}></span><span className="text-gray-700 truncate max-w-[140px]" title={nodeAName}>{nodeAName}</span></div>
                            <div className="flex items-center space-x-1"><span className="w-4 h-4 inline-block rounded" style={{ background: nodeBColor }}></span><span className="text-gray-700 truncate max-w-[140px]" title={nodeBName}>{nodeBName}</span></div>
                            <div className="flex items-center space-x-2">
                              <span className="text-gray-500">Gradient:</span>
                              <div className="h-3 w-32 rounded bg-gradient-to-r" style={{ background: `linear-gradient(to right, ${nodeAColor}, ${nodeBColor})` }}></div>
                              <span className="text-gray-500">A → B</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-center">
                          <svg width={860} height={260}>
                            <Wordcloud
                              words={words}
                              width={860}
                              height={260}
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
                        <p className="mt-2 text-center text-xs text-muted-foreground">Selection uses juxRank = log10(O1+O2) × LogRatio: 50% lowest and 50% highest by juxRank (2× token limit = {2 * limitForCloudBase} tokens). Size = (O1+O2). Color uses relative percentage share (%1 vs %2) so differing corpus sizes don't bias color; shifts toward {nodeAName} (left) or {nodeBName} (right).</p>
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
                      <h3 className="mb-4 text-lg font-semibold text-foreground">Statistical Measures</h3>
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
                        <div className="max-w-xl text-xs text-muted-foreground">
                          Showing first N and last N rows of the sorted table (with ellipsis if truncated). Sorting always applies to the full set before trimming.
                        </div>
                      </div>
                      <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3">
                        <div className="text-sm text-muted-foreground">
                          <strong>Statistical Analysis Key:</strong>
                          <br />
                          <strong>O1/O2:</strong> Observed frequencies in each dataset &nbsp;&nbsp;
                          <strong>%1/%2:</strong> Percentage of total tokens in each dataset
                          <br />
                          <strong>LL:</strong> Log Likelihood G2 statistic (higher = more significant difference) &nbsp;&nbsp;
                          <strong>%DIFF:</strong> Percentage point difference between datasets
                          <br />
                          <strong>Bayes:</strong> Bayes Factor (BIC) &nbsp;&nbsp;
                          <strong>ELL:</strong> Effect Size for Log Likelihood &nbsp;&nbsp;
                          <strong>RRisk:</strong> Relative Risk ratio
                          <br />
                          <strong>LogRatio:</strong> Log of relative frequencies &nbsp;&nbsp;
                          <strong>OddsRatio:</strong> Odds ratio between datasets
                          <br />
                          <strong>Significance:</strong> **** p&lt;0.0001, *** p&lt;0.001, ** p&lt;0.01, * p&lt;0.05
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

                        const raw = results.statistics
                          .filter((stat: any) => !appliedStopSet.has(String(stat.token || '').toLowerCase()))
                          .filter((stat: any) => stat.log_likelihood_llv > 0);

                        const sorted = (() => {
                          const colActive = statsSortColumn || 'log_likelihood_llv';
                          return [...raw].sort((a, b) => {
                            const col = statsSortColumn;
                            if (col === 'significance') {
                              const rank = (s: any) => (s.significance || '').length; // more * = higher
                              const va = rank(a); const vb = rank(b);
                              return statsSortDirection === 'asc' ? va - vb : vb - va;
                            }
                            const def = columns.find(c => c.key === colActive);
                            if (!def) return 0;
                            const va = def.accessor(a);
                            const vb = def.accessor(b);
                            if (typeof va === 'string' || typeof vb === 'string') {
                              const sa = (va ?? '').toString();
                              const sb = (vb ?? '').toString();
                              if (sa < sb) return statsSortDirection === 'asc' ? -1 : 1;
                              if (sa > sb) return statsSortDirection === 'asc' ? 1 : -1;
                              return 0;
                            }
                            const na = (va === null || va === undefined || Number.isNaN(va)) ? -Infinity : va;
                            const nb = (vb === null || vb === undefined || Number.isNaN(vb)) ? -Infinity : vb;
                            return statsSortDirection === 'asc' ? na - nb : nb - na;
                          });
                        })();

                        const total = sorted.length;
                        const n = headTailN;
                        let display: any[] = [];
                        let truncated = false;
                        if (total <= n * 2) {
                          display = sorted; // no truncation
                        } else {
                          truncated = true;
                          const head = sorted.slice(0, n);
                          const tail = sorted.slice(total - n);
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
                        // Reuse same filtering + sorting to show full table live
                        const modalRaw = results.statistics
                          .filter((stat: any) => !appliedStopSet.has(String(stat.token || '').toLowerCase()))
                          .filter((stat: any) => stat.log_likelihood_llv > 0);
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
                        // Re-create columns definition to access inside this closure
                        const modalColumns = [
                          { key: 'token', accessor: (s: any) => s.token },
                          { key: 'freq_corpus_0', accessor: (s: any) => s.freq_corpus_0 },
                          { key: 'percent_corpus_0', accessor: (s: any) => s.percent_corpus_0 },
                          { key: 'freq_corpus_1', accessor: (s: any) => s.freq_corpus_1 },
                          { key: 'percent_corpus_1', accessor: (s: any) => s.percent_corpus_1 },
                          { key: 'log_likelihood_llv', accessor: (s: any) => s.log_likelihood_llv },
                          { key: 'percent_diff', accessor: (s: any) => s.percent_diff },
                          { key: 'bayes_factor_bic', accessor: (s: any) => s.bayes_factor_bic },
                          { key: 'effect_size_ell', accessor: (s: any) => s.effect_size_ell },
                          { key: 'relative_risk', accessor: (s: any) => s.relative_risk },
                          { key: 'log_ratio', accessor: (s: any) => s.log_ratio },
                          { key: 'odds_ratio', accessor: (s: any) => s.odds_ratio },
                          { key: 'significance', accessor: (s: any) => s.significance || '' }
                        ];
                        const modalSorted = (() => {
                          const colActive = statsSortColumn || 'log_likelihood_llv';
                          return [...modalRaw].sort((a, b) => {
                            const col = statsSortColumn;
                            if (col === 'significance') {
                              const rank = (s: any) => (s.significance || '').length;
                              const va = rank(a); const vb = rank(b);
                              return statsSortDirection === 'asc' ? va - vb : vb - va;
                            }
                            const def = modalColumns.find(c => c.key === colActive);
                            if (!def) return 0;
                            const va = def.accessor(a);
                            const vb = def.accessor(b);
                            if (typeof va === 'string' || typeof vb === 'string') {
                              const sa = (va ?? '').toString();
                              const sb = (vb ?? '').toString();
                              if (sa < sb) return statsSortDirection === 'asc' ? -1 : 1;
                              if (sa > sb) return statsSortDirection === 'asc' ? 1 : -1;
                              return 0;
                            }
                            const na = (va === null || va === undefined || Number.isNaN(va)) ? -Infinity : va;
                            const nb = (vb === null || vb === undefined || Number.isNaN(vb)) ? -Infinity : vb;
                            return statsSortDirection === 'asc' ? na - nb : nb - na;
                          });
                        })();

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
                      
                      {(results.statistics
                        .filter((stat: any) => !appliedStopSet.has(String(stat.token || '').toLowerCase()))
                        .filter((stat: any) => stat.log_likelihood_llv > 0).length === 0) && (
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
            ) : (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {results.message ?? 'The analysis failed. Please try again.'}
              </div>
            )}
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

export default TokenFrequencyTab;
