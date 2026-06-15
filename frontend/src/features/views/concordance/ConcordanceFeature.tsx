import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import {
  concordanceDetachOptions,
  concordanceTaskDispersionBins,
  concordanceTaskRequest,
  concordanceTaskResult,
} from '@/api/generated/sdk.gen';
import type {
  ConcordanceAnalysisResponse,
  ConcordanceDispersionBinRow,
} from '@/api/generated/types.gen';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useNodeColumnInfos } from '@/features/workspace/common/hooks/useNodeColumnInfos';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { Card, CardContent } from '@/components/ui/card';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import type { MultiSeriesChartType } from '@/features/views/common/components/MultiSeriesChart';
import {
  useLastRunRequest,
  useAnalysisFeature,
  useSafeResult,
  VIZ_PALETTE,
  executeAnalysisRerun,
} from '../common';
import { useTabNodeInputs } from '../common/nodeInputs';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import type { AnalysisTabInput } from '@/api/generated/types.gen';
import type { WorkspaceNodeLike } from '../common/nodeSelectionTypes';
import { pruneTasksById } from '@/features/views/common/analysisTaskUtils';
import { useConcordanceTaskFlow, type PaginationState } from './hooks/useConcordanceTaskFlow';
import { useConcordanceMetadataColumns } from './hooks/useConcordanceMetadataColumns';
import { useConcordanceMaterializedEvents } from './hooks/useConcordanceMaterializedEvents';
import { useConcordancePendingHandoff } from './hooks/useConcordancePendingHandoff';
import { useConcordanceViewModeSwap } from './hooks/useConcordanceViewModeSwap';
import { ConcordanceParameterPanel } from './components/ConcordanceParameterPanel';
import TokenizerModelSelector from '../common/components/TokenizerModelSelector';
import { ConcordanceResultsPanel } from './components/ConcordanceResultsPanel';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../common/components/useRowDetailDialog';
import { highlightMatchInText } from '../common/components/highlightText';
import { ConcordanceDetachDialog } from './components/ConcordanceDetachDialog';
import { ConcordanceDispersionDetachDialog } from './components/ConcordanceDispersionDetachDialog';
import type { DetachDialogNodeOption } from '../common/components/DetachColumnsDialog';
import { useDetachColumnsState } from '../common/hooks/useDetachColumnsState';
import {
  usePersistNodeDocumentColumn,
  usePersistNodeTokenizationPreference,
} from '../common/hooks/usePersistNodeDocumentColumn';
import {
  DISPERSION_DEFAULT_BIN_COUNT,
  toCellText,
  type DispersionDisplayBinCount,
  type TaggedBinRow,
} from './concordanceViewModels';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_CORE_COLUMNS,
  CONCORDANCE_FREQ_COLUMNS,
} from '../common/generatedColumns';

const CORE_COLS = [...CONCORDANCE_CORE_COLUMNS];
const FREQ_COLS = [...CONCORDANCE_FREQ_COLUMNS];
const ALL_CONC_COLS_SET = new Set<string>([...CORE_COLS, ...FREQ_COLS]);
// Generated CONC_* output columns that the per-hit detach dialog ticks by
// default — the concordance result columns plus the raw-window extraction.
// Source metadata columns stay unchecked so "Add to Workspace" carries the
// concordance output out of the box without manual selection.
const CONC_DEFAULT_DETACH_COLS = new Set<string>([
  ...CORE_COLS,
  ...FREQ_COLS,
  CONCORDANCE_COLUMN_KEYS.extraction,
]);
type ConcordanceGroupedRow = Record<string, unknown>[];

/** Orchestrates the full concordance analysis UI, task lifecycle, and detach flows. */
/**
 * Rendered by: the analysis feature registry when this panel is selected because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * Tab props (optional): when rendered inside an analysis tab by
 * ConcordanceTabbedFeature, ``tabId`` identifies the active tab, ``tabTaskId``
 * seeds deterministic hydration of that tab's task, and ``onTabTaskChange``
 * lets the feature report task id assignment/clear back to the tab record. All
 * are absent in the legacy non-tabbed mounting, where behaviour is unchanged.
 */
export interface ConcordanceFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
  tabInputs?: AnalysisTabInput[];
  onTabInputsChange?: (inputs: AnalysisTabInput[]) => void;
}

function ConcordanceFeature({
  tabId,
  tabTaskId,
  onTabTaskChange,
  tabInputs,
  onTabInputsChange,
}: ConcordanceFeatureProps = {}) {
  // Anchor ref for results container to stabilize scroll on view mode toggle
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { selectedNodes } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const { currentWorkspaceId } = useWorkspaceData();
  const { detachConcordance, detachConcordanceDispersion, materializeConcordance, selectNodes } =
    useWorkspaceActions();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'concordance';
  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const { getAuthHeaders } = useAuth();
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
  });
  const persistTokenizerPreference = usePersistNodeTokenizationPreference({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
  });
  const {
    nodeColumnSelections,
    setColumn: setNodeColumnSelection,
    selectedNodes: panelSelectedNodes,
    resolvedNodes: inputResolvedNodes,
    addNodes,
    removeNode,
    clear: clearInputs,
    getAddRejection,
    availableNodes,
    canAddMore,
    graphSelectedIds,
  } = useTabNodeInputs({
    tabInputs,
    onTabInputsChange,
    constraints: {
      allowedDataTypes: ['string'],
      maxNodes: 2,
      docTypeOnly: true,
    },
  });
  // Shared node-inputs result re-bundled for the parameter panel.
  const nodeInputs = {
    nodeColumnSelections,
    setColumn: setNodeColumnSelection,
    selectedNodes: panelSelectedNodes,
    resolvedNodes: inputResolvedNodes,
    addNodes,
    removeNode,
    clear: clearInputs,
    getAddRejection,
    availableNodes,
    canAddMore,
    graphSelectedIds,
  } as ReturnType<typeof useTabNodeInputs>;
  // Add-node-as-needed model has no lock; ids derive from the inputs.
  const activeNodeIds = inputResolvedNodes.map((r) => r.id);
  // Last-run request, used only to compute the Run vs Re-run button state.
  const { serverRequest } = useLastRunRequest({
    analysisType: 'concordance_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    taskId: tabTaskId ?? null,
  });
  /** Replaces this tab's inputs from a node/column selection list (hydration + handoff). */
  const applyInputsFromSelections = (
    sels: { nodeId: string; column?: string | null }[],
  ) => {
    onTabInputsChange?.(
      sels
        .filter((s) => s.nodeId)
        .map((s) => ({ node_id: s.nodeId, column: s.column ?? null })),
    );
  };
  const pendingConcordance = useAnalysisStore((state) => state.pendingConcordance);
  const clearPendingConcordance = useAnalysisStore((state) => state.clearPendingConcordance);
  const setTasks = useAnalysisStore((state) => state.setTasks);
  const materializedEvents = useAnalysisStore((state) => state.materializedEvents);
  const [searchWord, setSearchWord] = useState('');
  const [numLeftTokens, setNumLeftTokens] = useState(10);
  const [numRightTokens, setNumRightTokens] = useState(10);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  // Concordance has two engines. ``regex`` walks raw text (the historical
  // default, preserving ``equ\w*``-style affordances); ``tokens`` walks the
  // tokenization column prepared by the selected tokenizer model for
  // actual-token context. Auto-picked below when every selected column has a
  // tokenizer model and the user hasn't manually overridden.
  const [searchMode, setSearchMode] = useState<'regex' | 'tokens'>('regex');
  const [searchModeUserSet, setSearchModeUserSet] = useState(false);
  const [tokenizerModelsByNode, setTokenizerModelsByNode] = useState<Record<string, string>>({});
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  // Metadata visibility derives from the selected columns: any selection
  // shows the corresponding metadata columns in the results table.
  const showMetadata = selectedMetadataColumns.length > 0;
  const [concordanceView, setConcordanceView] = useState<'table' | 'dispersion'>('table');
  const showDispersion = concordanceView === 'dispersion';
  const [proportionalDispersionBars, setProportionalDispersionBars] = useState(false);
  const [colourMatches, setColourMatches] = useState(false);
  const [lowercaseMatches, setLowercaseMatches] = useState(false);
  const [hiddenMatchedTexts, setHiddenMatchedTexts] = useState<Set<string>>(new Set());
  const [binCount, setBinCount] = useState<DispersionDisplayBinCount>(DISPERSION_DEFAULT_BIN_COUNT);
  const [combinedSourceMode, setCombinedSourceMode] = useState<'aggregate' | 'split'>('aggregate');
  const [dispersionChartType, setDispersionChartType] = useState<MultiSeriesChartType>('line');
  const [selectedBinIndices, setSelectedBinIndices] = useState<Record<string, Set<number>>>({});
  const lastSelectedBinRef = useRef<Record<string, number | null>>({});
  const handleBinSelect = useCallback((blockKey: string, index: number, shiftHeld: boolean) => {
    setSelectedBinIndices((prev) => {
      const prevSet = prev[blockKey] ?? new Set<number>();
      const next = new Set(prevSet);
      const lastIdx = lastSelectedBinRef.current[blockKey];
      if (shiftHeld && typeof lastIdx === 'number') {
        const [from, to] = lastIdx < index ? [lastIdx, index] : [index, lastIdx];
        for (let i = from; i <= to; i++) next.add(i);
      } else if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return { ...prev, [blockKey]: next };
    });
    lastSelectedBinRef.current[blockKey] = index;
  }, []);
  const handleClearBinSelection = useCallback((blockKey: string) => {
    setSelectedBinIndices((prev) => {
      if (!prev[blockKey]) return prev;
      const next: Record<string, Set<number>> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (key !== blockKey) next[key] = value;
      }
      return next;
    });
    lastSelectedBinRef.current[blockKey] = null;
  }, []);
  // Bin indices identify ranges (e.g. index 7 = 70–80 % in a 10-bin chart but
  // 7–8 % in a 100-bin chart). Selections are not portable across bin counts,
  // so clear every block's selection whenever the bin count changes.
  const handleBinCountChange = useCallback((value: DispersionDisplayBinCount) => {
    setBinCount(value);
    setSelectedBinIndices((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    lastSelectedBinRef.current = {};
  }, []);
  const [liveMaterializedBins, setMaterializedBins] = useState<
    Record<string, ConcordanceDispersionBinRow[]>
  >({});
  // Declared early so the position-fetch effect / lookups can reference it.
  // The setter is also used further below by the materialise-task watcher.
  const [liveMaterializedPaths, setMaterializedPaths] = useState<Record<string, string>>({});
  const [resultsViewportWidth, setResultsViewportWidth] = useState(0);
  const [liveResults, concordanceResultsRef, _setResultSafely, setResults] =
    useSafeResult<ConcordanceAnalysisResponse>();
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);

  const results = liveResults;
  const materializedPaths = liveMaterializedPaths;
  const materializedBins = liveMaterializedBins;
  const labelToNodeId = useMemo<Record<string, string> | null>(() => {
    const params = liveResults?.analysis_params;
    const mapping = params?.label_to_node_map;
    if (mapping && typeof mapping === 'object') {
      const normalized: Record<string, string> = {};
      Object.entries(mapping).forEach(([label, value]) => {
        if (typeof label === 'string' && typeof value === 'string' && label) {
          normalized[label] = value;
        }
      });
      return normalized;
    }
    return null;
  }, [liveResults]);

  // Per-source visualisation colours. Each selected node gets a stable
  // colour by its position in the panel selection, used to tint the
  // combined results table and metadata column groupings. This is a
  // purely local, in-result viz mapping — there is no node-colour store,
  // persistence, or user picker anymore.
  const defaultPalette = VIZ_PALETTE;
  const nodeColors = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    panelSelectedNodes.forEach((node, idx) => {
      const colour = VIZ_PALETTE[idx % VIZ_PALETTE.length] ?? '';
      for (const candidate of [node.id, node.node_id]) {
        if (typeof candidate === 'string' && candidate) map[candidate] = colour;
      }
    });
    return map;
  }, [panelSelectedNodes]);

  const concordanceTaskId = useMemo(() => {
    const md = (liveResults)?.metadata as
      | Record<string, unknown>
      | undefined;
    const value = md?.task_id ?? md?.taskId;
    return typeof value === 'string' ? value : '';
  }, [liveResults]);
  const concordanceTaskIdFallbackRef = useRef('');
  useEffect(() => {
    if (concordanceTaskId) concordanceTaskIdFallbackRef.current = concordanceTaskId;
  }, [concordanceTaskId]);

  const resolveNodeIdForKey = useCallback(
    (nodeKey: string): string | null => {
      if (nodeKey === '__COMBINED__') return null;
      const direct = panelSelectedNodes.find((n: WorkspaceNodeLike) => {
        const d = n.data as Record<string, unknown> | undefined;
        const dataName = d && typeof d === 'object' ? (d.name as string | undefined) : undefined;
        return n.id === nodeKey || n.name === nodeKey || dataName === nodeKey;
      });
      if (direct?.id) return direct.id;
      const mapped = labelToNodeId?.[nodeKey];
      if (mapped) return mapped;
      return null;
    },
    [panelSelectedNodes, labelToNodeId],
  );

  /** Resolves a displayed result block key to the source node ids needed for materialized bins. */
  /**
   * Called by: ConcordanceFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   */
  const relevantNodeIdsForKey = (nodeKey: string): string[] => {
    if (nodeKey === '__COMBINED__') {
      return panelSelectedNodes
        .map((n: WorkspaceNodeLike) => n.id)
        .filter((id: string | undefined): id is string => Boolean(id));
    }
    const id = resolveNodeIdForKey(nodeKey);
    return id ? [id] : [];
  };

  // Fetch slim hit positions for any node that has been materialised on the
  // backend (signalled by an entry in client-side `materializedPaths`) but
  // whose positions aren't yet cached. Decoupled from `nodeData.materialized`
  // so combined-view lookups and not-yet-refreshed pages still work.
  useEffect(() => {
    if (!showDispersion || proportionalDispersionBars) return;
    // Same trick as the materialised-events consumer: when the bare task id is
    // briefly empty (results being refetched after a materialise), fall back
    // to the last known good value so we don't drop the fetch.
    const effectiveTaskId = concordanceTaskId || concordanceTaskIdFallbackRef.current;
    if (!effectiveTaskId) return;
    const panelIds = panelSelectedNodes
      .map((n: WorkspaceNodeLike) => n.id)
      .filter((id: string | undefined): id is string => Boolean(id));
    const validIds = Object.keys(materializedPaths).filter((id) => panelIds.includes(id));
    const missing = validIds.filter((id) => !(id in materializedBins));
    if (missing.length === 0) return;
    let cancelled = false;
    const authHeaders = getAuthHeaders();
    void Promise.all(
      missing.map(async (nodeId) => {
        try {
          const { data: resp } = await concordanceTaskDispersionBins({
            headers: authHeaders,
            path: { task_id: effectiveTaskId },
            query: { node_id: nodeId },
            throwOnError: true,
          });
          return [nodeId, resp.rows] as const;
        } catch (err) {
          console.error('Failed to fetch concordance dispersion bins', nodeId, err);
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setMaterializedBins((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showDispersion,
    proportionalDispersionBars,
    concordanceTaskId,
    materializedPaths,
    panelSelectedNodes,
  ]);

  /** Reports whether every source node behind a result block has a cached materialized path. */
  /**
   * Called by: ConcordanceFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   */
  const isBlockMaterialised = (nodeKey: string): boolean => {
    const ids = relevantNodeIdsForKey(nodeKey);
    return ids.length > 0 && ids.every((id) => id in materializedPaths);
  };

  /** Combines per-node server bins into the tagged row shape expected by dispersion charts. */
  /**
   * Called by: ConcordanceFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   * Flow: resolve source node ids for the display key, require all materialized paths and bins, tag each bin with its node label, then return chart-ready rows.
   */
  const getMaterializedBinsForKey = (nodeKey: string): TaggedBinRow[] | undefined => {
    const ids = relevantNodeIdsForKey(nodeKey);
    if (ids.length === 0) return undefined;
    if (!ids.every((id) => id in materializedPaths)) return undefined;
    if (!ids.every((id) => id in materializedBins)) return undefined;
    const tagged: TaggedBinRow[] = [];
    for (const id of ids) {
      const node = panelSelectedNodes.find((n: WorkspaceNodeLike) => n.id === id);
      const sourceLabel = node?.name ?? id;
      const bins = materializedBins[id];
      if (!bins) continue;
      for (const row of bins) {
        tagged.push({ ...row, __source_node: sourceLabel });
      }
    }
    return tagged;
  };

  const allMatchedTexts = useMemo((): string[] => {
    if (!showDispersion || !colourMatches || !results?.data) return [];
    const seen = new Set<string>();
    for (const [nodeKey, nodeData] of Object.entries(results.data)) {
      const binRows = getMaterializedBinsForKey(nodeKey);
      if (binRows) {
        for (const row of binRows) {
          const raw = row.matched_text ?? '';
          if (raw) seen.add(lowercaseMatches ? raw.toLowerCase() : raw);
        }
        continue;
      }
      for (const group of nodeData.data) {
        for (const hit of group) {
          const raw = toCellText(hit[CONCORDANCE_COLUMN_KEYS.matchedText]);
          if (raw) seen.add(lowercaseMatches ? raw.toLowerCase() : raw);
        }
      }
    }
    return [...seen].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showDispersion,
    colourMatches,
    lowercaseMatches,
    results?.data,
    materializedBins,
    materializedPaths,
    panelSelectedNodes,
  ]);

  const matchedTextColorMap = useMemo(
    (): Record<string, string> =>
      Object.fromEntries(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- i % length is always a valid index of the non-empty palette
        allMatchedTexts.map((t, i) => [t, VIZ_PALETTE[i % VIZ_PALETTE.length]!]),
      ),
    [allMatchedTexts],
  );

  const [viewMode, setViewMode] = useState<'separated' | 'combined'>('separated');
  const [combinedPage, setCombinedPage] = useState(1);

  useEffect(() => {
    const element = resultsViewportRef.current;
    if (!element) {
      return;
    }

    /** Keeps dispersion column sizing synced with the rendered results viewport. */
    /**
     * Called by: ConcordanceFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
     */
    const updateWidth = () => {
      setResultsViewportWidth(element.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [results]);

  // Hoisted up so the metadata-column hook can read it (it consults each
  // panel node's selected text column to exclude it from the metadata list).
  const effectiveNodeColumnSelections = nodeColumnSelections;

  const { availableMetadataColumns, metadataColumnSections, metadataDisabledReason } =
    useConcordanceMetadataColumns({
      results,
      panelSelectedNodes,
      effectiveNodeColumnSelections,
      getColumnInfos,
      viewMode,
      nodeColors,
      resolveNodeIdForKey,
    });
  const availableMetadataColumnsKey = availableMetadataColumns.join('|');

  // Map any node's id/name variants to its assigned color (used in combined table).
  const sourceColorMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    panelSelectedNodes.forEach((node, idx) => {
      const candidateIds = [node.id, node.node_id]
        .map((val) => (typeof val === 'string' ? val : null))
        .filter(Boolean) as string[];
      const primaryId = candidateIds[0] ?? `node-${String(idx)}`;
      const assigned = nodeColors[primaryId] ?? defaultPalette[idx % defaultPalette.length] ?? '';
      const variants = new Set<string>();
      [primaryId, node.name, node.name, node.label, node.label].forEach((value) => {
        if (typeof value === 'string' && value.trim()) {
          variants.add(value);
        }
      });
      variants.forEach((value) => {
        map[value.toLowerCase()] = assigned;
      });
    });
    return map;
  }, [panelSelectedNodes, nodeColors, defaultPalette]);

  // Tokens mode is available when every selected node that has a column also
  // has a tokenizer model selected — either chosen in this session or
  // previously persisted to the backend (read back via node.tokenizer_models).
  const effectiveTokenizerModelsByNode = useMemo(() => {
    // Seed with models persisted to the backend from previous sessions,
    // then apply any live overrides the user has made in this session.
    const fromNodes: Record<string, string> = {};
    for (const sel of effectiveNodeColumnSelections) {
      if (!sel.column) continue;
      const node = panelSelectedNodes.find((n: WorkspaceNodeLike) => {
        const ids = [n.id, n.node_id];
        return ids.some((id) => typeof id === 'string' && id === sel.nodeId);
      });
      const stored = node?.tokenizer_models?.[sel.column];
      if (stored) fromNodes[sel.nodeId] = stored;
    }
    return { ...fromNodes, ...tokenizerModelsByNode };
  }, [effectiveNodeColumnSelections, panelSelectedNodes, tokenizerModelsByNode]);

  const tokensModeAvailable = useMemo(() => {
    const selectionsWithColumn = effectiveNodeColumnSelections.filter((s) => s.column);
    if (selectionsWithColumn.length === 0) return false;
    return selectionsWithColumn.every((s) => Boolean(effectiveTokenizerModelsByNode[s.nodeId]));
  }, [effectiveNodeColumnSelections, effectiveTokenizerModelsByNode]);

  // Auto-pick tokens-mode when it becomes available AND the user hasn't
  // manually overridden. When tokens stop being available (e.g. user
  // switches to a data block without tokenization for the selected column) force
  // regex and clear the user-override flag — the override was
  // contextual to a node/column selection that no longer holds, and
  // leaving it sticky lets stale 'tokens' survive onto an ineligible
  // block, where Run then errors at the backend.
  useEffect(() => {
    void Promise.resolve().then(() => {
      if (!tokensModeAvailable) {
        setSearchMode('regex');
        setSearchModeUserSet(false);
        return;
      }
      if (searchModeUserSet) return;
      setSearchMode('tokens');
    });
  }, [tokensModeAvailable, searchModeUserSet]);

  // Pagination and sorting state - separate for each node
  const [nodePagination, setNodePagination] = useState<PaginationState>({});

  // Individual node loading states for pagination/sorting (separate from main search)
  const [nodeLoading, setNodeLoading] = useState<Record<string, boolean>>({});

  // Individual node detaching states
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});

  // Individual node materializing states and tracked task ids
  const [nodeMaterializing, setNodeMaterializing] = useState<Record<string, boolean>>({});
  const [materializeTaskIds, setMaterializeTaskIds] = useState<Record<string, string>>({});
  const [materializeSummaries, setMaterializeSummaries] = useState<
    Record<string, { recordCount: number; uniqueDocuments: number; totalDocuments: number }>
  >({});

  // Detach dialog state
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [pendingDetachNodes, setPendingDetachNodes] = useState<
    { nodeId: string; column: string; nodeLabel: string }[]
  >([]);
  const [detachNodeOptions, setDetachDialogNodeOptions] = useState<DetachDialogNodeOption[]>([]);
  const {
    selectedDetachColumns,
    setSelectedDetachColumns,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
  } = useDetachColumnsState(detachNodeOptions);

  // Dispersion-detach dialog state. Mirrors the per-hit dialog but with
  // dispersion-specific column semantics: the document column is opt-out
  // (default checked) and CONC_* columns are hidden (always computed by
  // the worker, not user-selectable).
  const [dispersionDetachDialogOpen, setDispersionDetachDialogOpen] = useState(false);
  const [pendingDispersionDetachNodes, setPendingDispersionDetachNodes] = useState<
    { nodeId: string; column: string; nodeLabel: string }[]
  >([]);
  const [dispersionDetachOptions, setDispersionDetachOptions] = useState<DetachDialogNodeOption[]>(
    [],
  );
  const [pendingDispersionBinSelection, setPendingDispersionBinSelection] = useState<
    number[] | null
  >(null);
  const [pendingDispersionBinCount, setPendingDispersionBinCount] = useState<number>(0);
  const [pendingDispersionMatchedTexts, setPendingDispersionMatchedTexts] = useState<
    string[] | null
  >(null);
  const [pendingDispersionCaseInsensitive, setPendingDispersionCaseInsensitive] =
    useState<boolean>(false);
  const {
    selectedDetachColumns: selectedDispersionColumns,
    setSelectedDetachColumns: setSelectedDispersionColumns,
    toggleDetachColumn: toggleDispersionColumn,
    selectAllDetachColumns: selectAllDispersionColumns,
    deselectAllDetachColumns: deselectAllDispersionColumns,
  } = useDetachColumnsState(dispersionDetachOptions);

  // Global page size setting
  const [globalPageSize, setGlobalPageSize] = useState(20);

  // Detail view state
  const {
    detailPayload,
    detailOpen,
    setDetailOpen,
    openDetail: openRowDetail,
  } = useRowDetailDialog();
  const [concordanceDetailExtra, setConcordanceDetailExtra] = useState<{
    concordanceHits: Record<string, unknown>[];
    caseSensitive: boolean;
  } | null>(null);

  const {
    resolveTaskId,
    setLocalTaskId: setLocalConcordanceTaskId,
    isRunning: isSearching,
    setIsRunning: setIsSearching,
    taskStatus: concordanceTaskStatus,
    banner: concordanceWaitingBanner,
    hydrationState,
    clearResults,
    stopTask,
    isStopping,
  } = useAnalysisFeature<ConcordanceAnalysisResponse>({
    analysisType: 'concordance_analysis',
    taskType: 'concordance',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    // Tab-driven deterministic hydration: when mounted inside an analysis tab,
    // the tab's persisted task id must win task resolution over transient local
    // state. Undefined in non-tabbed use, which the resolver skips.
    hydrationTaskId: tabTaskId ?? null,
    resultRef: concordanceResultsRef,
    /** Fetches a completed concordance task result for polling and hydration. */
    // Called by: ConcordanceFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchResult: async (taskId, headers) => {
      const { data } = await concordanceTaskResult({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    /** Fetches the saved request so hydration can restore parameters and materialized state. */
    // Called by: ConcordanceFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchRequest: async (taskId, headers) => {
      const { data } = await concordanceTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    /** Copies freshly fetched task results into the feature's safe-result state. */
    // Called by: ConcordanceFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onResultFetched: (resultData) => {
      setResults(resultData);
    },
    /** Accepts restored result payloads from persisted analysis tasks. */
    // Called by: ConcordanceFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onHydratedResult: (resultPayload) => {
      const res = resultPayload?.data ?? resultPayload;
      if (res) {
        setResults(resultPayload);
      }
    },
    /** Restores concordance form controls and materialized caches from a saved request. */
    // Called by: useAnalysisFeature hydration because restored concordance tasks must rebuild node selections, search options, materialized paths, and bin caches together. Flow: unwrap the saved request, apply form fields, restore materialized metadata, then lock the submitted nodes.
    onHydratedRequest: (requestPayload) => {
      const req = (requestPayload as Record<string, unknown> | undefined)?.data ?? requestPayload;
      if (!req || typeof req !== 'object') return;
      const reqObj = req as Record<string, unknown>;
      const nodeIds: string[] = Array.isArray(reqObj.node_ids)
        ? (reqObj.node_ids.slice(0, 2) as string[])
        : [];
      const node_columns: Record<string, string> =
        (reqObj.node_columns as Record<string, string> | undefined) ?? {};
      const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] ?? '' }));
      // Legacy migration only: a tab that ran before the add-node-as-needed
      // model has a task_id but no persisted inputs. Seed them once from the
      // saved request. Tabs created under the new model already carry inputs,
      // so we never clobber the user's curated selection here.
      if (!tabInputs || tabInputs.length === 0) {
        applyInputsFromSelections(sels);
      }
      setSearchWord(toCellText(reqObj.search_word));
      setNumLeftTokens(Number(reqObj.num_left_tokens ?? 10));
      setNumRightTokens(Number(reqObj.num_right_tokens ?? 10));
      const hydratedRegex = !!reqObj.regex;
      setRegex(hydratedRegex);
      setWholeWord(
        hydratedRegex ? false : typeof reqObj.whole_word === 'boolean' ? reqObj.whole_word : true,
      );
      setCaseSensitive(!!reqObj.case_sensitive);
      // Combined view is a client-only synthesis and is never persisted, so
      // hydrated tasks always restore to separated; the user can re-enter
      // combined via the toggle (which re-pages both nodes on demand).
      setViewMode('separated');
      // Replace (not merge) on hydration so the saved task's materialised
      // state is the source of truth. Otherwise stale entries from a
      // previous task could survive a re-run that produced an empty
      // `materialized_paths`, leaving the Process All button incorrectly
      // disabled and the bin-fetch hitting "No materialised concordance for
      // node X" 404s. Also reset the bin cache + applied-event tracker so
      // the consumer + bin-fetch effects re-populate cleanly for whatever
      // the hydrated task contains.
      const paths = reqObj.materialized_paths as Record<string, string> | undefined;
      const nextPaths = paths && typeof paths === 'object' ? { ...paths } : {};
      setMaterializedPaths(nextPaths);
      setMaterializedBins({});
      resetProcessedEvents();
      const summaries = reqObj.materialize_summaries as
        | Record<string, Record<string, unknown>>
        | undefined;
      const nextSummaries: Record<
        string,
        { recordCount: number; uniqueDocuments: number; totalDocuments: number }
      > = {};
      if (summaries && typeof summaries === 'object') {
        for (const [nid, s] of Object.entries(summaries)) {
          nextSummaries[nid] = {
            recordCount: Number(s.record_count) || 0,
            uniqueDocuments: Number(s.unique_documents_with_hits) || 0,
            totalDocuments: Number(s.total_source_documents) || 0,
          };
        }
      }
      setMaterializeSummaries(nextSummaries);
    },
    /** Clears result-specific state while preserving local controls when requested by handoff flows. */
    // Called by: ConcordanceFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onCleared: (_, options) => {
      setResults(null);
      setNodePagination({});
      setCombinedPage(1);
      setMaterializeSummaries({});
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared. Preserve-local-state clears (handoff
      // flows) intentionally keep the tab→task link. Inputs are intentionally
      // left intact so the user keeps their curated selection after clearing.
      onTabTaskChange?.(null);
    },
    /** Keeps the global task list free of concordance task duplicates after lifecycle updates. */
    // Called by: ConcordanceFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    pruneGlobalTasks: (taskIds) => {
      setTasks((prev) => {
        if (!Array.isArray(prev)) return prev;
        return taskIds.length > 0 ? pruneTasksById(prev, taskIds) : prev;
      });
    },
    /** Lets the shared analysis lifecycle recognize in-flight concordance responses. */
    // Called by: ConcordanceFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    isResultRunning: (r) => r?.state === 'running',
  });

  // (effectiveNodeColumnSelections is declared above so it can be referenced
  // by the metadata-column section IIFE.)

  // No auto-selection on activation: Show metadata starts empty and the user
  // explicitly ticks the columns they want. We just clean up any selections
  // that are no longer in the available set (e.g. after a re-run that drops
  // a column from the source data).
  useEffect(() => {
    void Promise.resolve().then(() => {
      setSelectedMetadataColumns((prev) => {
        const filtered = prev.filter((column) => availableMetadataColumns.includes(column));
        if (filtered.length === prev.length) return prev;
        return filtered;
      });
    });
  }, [availableMetadataColumns, availableMetadataColumnsKey]);

  const {
    handleSearch,
    updateStoredResult,
    handleSort,
    handlePageChange,
    persistResultPreferences,
    handleDetach,
    handleDispersionDetach,
    handleMaterialize,
  } = useConcordanceTaskFlow({
    state: {
      currentWorkspaceId,
      searchWord,
      activeNodeIds,
      effectiveNodeColumnSelections,
      globalPageSize,
      nodePagination,
      viewMode,
      combinedPage,
      numLeftTokens,
      numRightTokens,
      regex,
      wholeWord,
      caseSensitive,
      searchMode,
    },
    actions: {
      setNodePagination,
      setViewMode,
      setCombinedPage,
      setIsSearching,
      setResults,
      setLocalTaskId: setLocalConcordanceTaskId,
      setNodeLoading,
      setNodeDetaching,
      setNodeMaterializing,
      setMaterializeTaskIds,
      // Persist the run's assigned task id onto the active tab so reload
      // rehydrates the same task. No-op when not tab-mounted.
      onTaskIdAssigned: (taskId) => {
        if (tabId) onTabTaskChange?.(taskId);
      },
    },
    lock: {
      getAuthHeaders,
      resolveTaskId,
      detachConcordance,
      detachConcordanceDispersion,
      materializeConcordance,
    },
  });

  // Single source of truth for page size across every concordance result table.
  // Used by: each per-node / combined ServerPaginationFooter because changing
  // the size on any table must keep all tables in sync and persist once.
  // Flow: update globalPageSize, mirror it onto every node's internal pagination
  // (resetting to page 1), then persist unless the panel is read-only.
  const handleGlobalPageSizeChange = (newSize: number) => {
    setGlobalPageSize(newSize);
    setNodePagination((prev) => {
      const updated = { ...prev };
      for (const [nid, value] of Object.entries(updated)) {
        updated[nid] = { ...value, pageSize: newSize, currentPage: 1 };
      }
      return updated;
    });
    void persistResultPreferences({ pageSize: newSize });
  };

  // Run vs Re-run: with no locking, the primary button is gated purely by
  // whether the current params or node inputs differ from the last run.
  const lastRunRequest = (serverRequest) ?? null;
  /** Normalizes a saved concordance request's params for diffing against live form values. */
  const concordanceServerParams = (request: Record<string, unknown>) => ({
    search_word: typeof request.search_word === 'string' ? request.search_word : '',
    num_left_tokens:
      typeof request.num_left_tokens === 'number'
        ? request.num_left_tokens
        : typeof request.num_tokens_left === 'number'
          ? request.num_tokens_left
          : 5,
    num_right_tokens:
      typeof request.num_right_tokens === 'number'
        ? request.num_right_tokens
        : typeof request.num_tokens_right === 'number'
          ? request.num_tokens_right
          : 5,
    regex: typeof request.regex === 'boolean' ? request.regex : false,
    whole_word:
      typeof request.regex === 'boolean' && request.regex
        ? false
        : typeof request.whole_word === 'boolean'
          ? request.whole_word
          : true,
    case_sensitive: typeof request.case_sensitive === 'boolean' ? request.case_sensitive : false,
  });
  const currentConcordanceParams = {
    search_word: searchWord,
    num_left_tokens: numLeftTokens,
    num_right_tokens: numRightTokens,
    regex,
    whole_word: wholeWord,
    case_sensitive: caseSensitive,
  };
  const hasLastRun = Boolean(lastRunRequest);
  const hasChanges = !lastRunRequest
    ? true
    : hasParameterDiff(currentConcordanceParams, concordanceServerParams(lastRunRequest)) ||
      hasNodeSelectionChanged(
        nodeColumnSelections,
        lastRunRequest.node_ids as string[] | undefined,
        lastRunRequest.node_columns as Record<string, string> | undefined,
      );

  const actionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable:
      panelSelectedNodes.length > 0 &&
      Boolean(searchWord.trim()) &&
      nodeColumnSelections.length > 0 &&
      nodeColumnSelections.every((s) => Boolean(s.column)),
    hasLastRun,
    hasChanges,
    isBusy: isSearching,
    hasResults: Boolean(results),
  });

  // Track whether initial preference hydration from server results has been
  // applied.  After the first sync we stop overwriting globalPageSize from
  // response data to avoid a feedback loop: user changes page size → response
  // arrives with old page_size → effect overwrites user's choice → new request
  // fires → oscillation.
  const prefsSyncedRef = useRef(false);
  useEffect(() => {
    if (!results) {
      prefsSyncedRef.current = false;
      return;
    }
    // Only sync preferences on the first result load (hydration).
    if (prefsSyncedRef.current) return;
    prefsSyncedRef.current = true;

    const analysisParams = results.analysis_params ?? {};
    const preferenceSource =
      results.preferences ??
      ((analysisParams as Record<string, unknown>).preferences as
        | Record<string, unknown>
        | undefined) ??
      {};

    // Fall back to the first node's resolved pagination.page_size (which reflects
    // server-side estimation) when the analysis params don't carry it.
    const firstNodeEntry = Object.values(results.data)[0];
    const firstNodePageSize = firstNodeEntry?.pagination.page_size;

    const nextPageSize =
      preferenceSource.page_size ?? analysisParams.page_size ?? firstNodePageSize;
    if (
      typeof nextPageSize === 'number' &&
      Number.isFinite(nextPageSize) &&
      nextPageSize > 0 &&
      nextPageSize !== globalPageSize
    ) {
      // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
      const id = requestAnimationFrame(() => {
        setGlobalPageSize(nextPageSize);
        setNodePagination((prev) => {
          const updated = { ...prev };
          for (const [nodeId, value] of Object.entries(updated)) {
            updated[nodeId] = {
              ...value,
              pageSize: nextPageSize,
            };
          }
          return updated;
        });
      });
      return () => { cancelAnimationFrame(id); };
    }
  }, [results, globalPageSize, setNodePagination]);

  // Materialize lifecycle: terminal-state task watcher, task-id ref reset,
  // and `analysis_materialized` SSE consumer. See hook for details.
  const { resetProcessedEvents } = useConcordanceMaterializedEvents({
    concordanceTaskId,
    materializeTaskIds,
    materializedEvents,
    getAuthHeaders,
    resolveTaskId,
    persistResultPreferences,
    setNodeMaterializing,
    setMaterializeTaskIds,
    setMaterializedPaths,
    setMaterializeSummaries,
    setMaterializedBins,
    setGlobalPageSize,
    setNodePagination,
  });

  // Preserve results across transient graph refetches. Under the add-node-as-
  // needed model, editing a tab's inputs does NOT wipe the displayed results;
  // it flips the primary button to "Re-run". So there is no selection-driven
  // auto-clear effect here anymore.

  useEffect(() => {
    if (!currentWorkspaceId) {
      setLocalConcordanceTaskId(null);
    }
  }, [currentWorkspaceId, setLocalConcordanceTaskId]);

  useEffect(() => {
    if (concordanceTaskStatus.tasks.length === 0) {
      setLocalConcordanceTaskId(null);
    }
  }, [concordanceTaskStatus.tasks.length, setLocalConcordanceTaskId]);

  const {
    shouldAutoSearch,
    setShouldAutoSearch,
  } = useConcordancePendingHandoff({
    pendingConcordance,
    clearPendingConcordance,
    hydrationState,
    selectedNodes,
    setSearchWord,
    setNodeColumnSelections: (sels) => { applyInputsFromSelections(sels); },
    selectNodes,
  });

  // No auto-column recompute: a node's default column is chosen at add-time by
  // the node-inputs model, so there is no unlocked recompute effect here.

  // Color assignment now handled by stack allocator - no auto-fill effect needed

  /**
   * Called by: ConcordanceFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
    // Clear the tokenizer model for this node when the column changes; model
    // preferences are scoped to source columns.
    setTokenizerModelsByNode((prev) => {
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  /** Persists the tokenizer model chosen for a node/column when tokens mode is available. */
  /**
   * Called by: ConcordanceFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleTokenizerModelChange = (
    nodeId: string,
    column: string,
    model: string,
    language: string | null,
  ) => {
    setTokenizerModelsByNode((prev) => {
      if (model) return { ...prev, [nodeId]: model };
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
    void persistTokenizerPreference(nodeId, column, model, language);
  };

  useEffect(() => {
    if (!shouldAutoSearch) {
      return;
    }
    // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
    const id = requestAnimationFrame(() => {
      setShouldAutoSearch(false);
      void handleSearch(true);
    });
    return () => { cancelAnimationFrame(id); };
  }, [shouldAutoSearch, handleSearch, setShouldAutoSearch]);

  /** Delegates clearing to the shared analysis lifecycle only when a workspace is active. */
  /**
   * Called by: ConcordanceFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleClearResults = async () => {
    if (!currentWorkspaceId) return;
    await clearResults();
  };

  /** Runs or updates concordance after shared update checks pass. */
  /**
   * Called by: ConcordanceFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleRunOrUpdate = async () => {
    await executeAnalysisRerun({
      hasUnrunChanges: hasChanges,
      clearResults: handleClearResults,
      /** Starts the feature-specific concordance search after shared update checks pass. */
      // Called by: handleRunOrUpdate through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
      runFreshAnalysis: () =>
        handleSearch(true, undefined, undefined, undefined, undefined, true),
    });
  };

  const { combinedLoading, handleViewModeChange } = useConcordanceViewModeSwap({
    viewMode,
    setViewMode,
    results,
    setResults,
    combinedPage,
    globalPageSize,
    updateStoredResult,
    resultsRef,
  });

  /** Opens row details with concordance-specific hit context and metadata filtering. */
  /**
   * Called by: ConcordanceFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   * Flow: verify workspace context, choose grouped hits or the clicked row, cache concordance detail metadata, then open row details without analysis-only columns.
   */
  const handleRowClick = (
    row: Record<string, unknown>,
    _nodeId: string,
    column: string,
    groupedHits?: ConcordanceGroupedRow,
  ) => {
    if (!currentWorkspaceId) return;

    const concordanceHits = groupedHits && groupedHits.length > 0 ? groupedHits : [row];
    const primaryRecord = concordanceHits[0] ?? row;
    const record = { ...primaryRecord };
    const rawFullText = record[column];
    const fullText =
      rawFullText === null || rawFullText === undefined ? undefined : toCellText(rawFullText);

    setConcordanceDetailExtra({
      concordanceHits,
      caseSensitive: typeof row.case_sensitive === 'boolean' ? row.case_sensitive : caseSensitive,
    });

    openRowDetail({
      record,
      textColumn: column,
      fullText,
      excludeMetadataColumns: [...ALL_CONC_COLS_SET, CONCORDANCE_COLUMN_KEYS.dispersion],
    });
  };

  const concordanceCustomization = (() => {
    if (!detailPayload || !concordanceDetailExtra) return undefined;
    const { record } = detailPayload;
    const { concordanceHits, caseSensitive: detailCaseSensitive } = concordanceDetailExtra;

    const matchedTextValue = record[CONCORDANCE_COLUMN_KEYS.matchedText];

    return {
      label: 'Concordance',
      summaryFields: [
        {
          label: 'Search Word',
          value: searchWord,
          highlight: true,
        },
        {
          label: 'Matches',
          value: String(concordanceHits.length),
        },
        {
          label: 'L1 Word',
          value: toCellText(record[CONCORDANCE_COLUMN_KEYS.leftToken]),
        },
        ...(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq] != null
          ? [
              {
                label: 'L1 Freq',
                value: String(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq]),
              },
            ]
          : []),
        {
          label: 'R1 Word',
          value: toCellText(record[CONCORDANCE_COLUMN_KEYS.rightToken]),
        },
        ...(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq] != null
          ? [
              {
                label: 'R1 Freq',
                value: String(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq]),
              },
            ]
          : []),
      ],
      /** Highlights every concordance hit in the source text shown by the row-detail panel. */
      // Called by: ConcordanceFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
      renderDocumentText: (text: string) =>
        highlightMatchInText(
          text,
          concordanceHits.map((hit) => ({
            start: hit[CONCORDANCE_COLUMN_KEYS.startIdx],
            end: hit[CONCORDANCE_COLUMN_KEYS.endIdx],
          })),
          typeof matchedTextValue === 'string' && matchedTextValue.length > 0
            ? matchedTextValue
            : searchWord,
          detailCaseSensitive,
        ),
    };
  })();

  // --- Detach dialog helpers ---
  /**
   * Called by: ConcordanceFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
   */
  const openDetachDialog = async (
    nodes: { nodeId: string; column: string; nodeLabel: string }[],
  ) => {
    setPendingDetachNodes(nodes);

    try {
      const responses = await Promise.all(
        nodes.map((node) =>
          concordanceDetachOptions({
            headers: getAuthHeaders(),
            path: { node_id: node.nodeId },
            query: { column: node.column },
            throwOnError: true,
          }).then(({ data }) => data),
        ),
      );
      const options = responses.flatMap((response) => response.data?.nodes ?? []);
      // Default-select the generated CONC_* output columns so "Add to
      // Workspace" carries the concordance result columns without manual
      // ticking. Source metadata columns (and the opt-in document column)
      // stay unchecked.
      const initial: Record<string, string[]> = {};
      options.forEach((node) => {
        initial[node.node_id] = node.available_columns.filter((col) =>
          CONC_DEFAULT_DETACH_COLS.has(col),
        );
      });
      setSelectedDetachColumns(initial);
      setDetachDialogNodeOptions(options);
      setDetachDialogOpen(true);
    } catch (error) {
      console.error('Failed to load concordance detach options:', error);
      toast.error(
        `Failed to load concordance detach options: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      setPendingDetachNodes([]);
      setSelectedDetachColumns({});
    }
  };

  /** Dispatches per-hit detach requests for every selected source in the dialog. */
  /**
   * Called by: ConcordanceFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleDetachConfirm = async () => {
    for (const n of pendingDetachNodes) {
      const cols = selectedDetachColumns[n.nodeId] ?? [];
      await handleDetach(
        n.nodeId,
        n.column,
        n.nodeLabel,
        cols,
        materializedPaths[n.nodeId] ?? null,
      );
    }
    setDetachDialogOpen(false);
    setPendingDetachNodes([]);
    setSelectedDetachColumns({});
    setDetachDialogNodeOptions([]);
  };

  // --- Dispersion detach dialog helpers ---
  /**
   * Called by: ConcordanceFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
   */
  const openDispersionDetachDialog = async (
    nodes: { nodeId: string; column: string; nodeLabel: string }[],
    selectedBins: ReadonlySet<number> | null,
    binCount: number,
    options?: {
      selectedMatchedTexts?: string[] | null;
      matchCaseInsensitive?: boolean;
    },
  ) => {
    setPendingDispersionDetachNodes(nodes);
    setPendingDispersionBinSelection(
      selectedBins && selectedBins.size > 0 ? Array.from(selectedBins) : null,
    );
    setPendingDispersionBinCount(binCount);
    setPendingDispersionMatchedTexts(options?.selectedMatchedTexts ?? null);
    setPendingDispersionCaseInsensitive(!!options?.matchCaseInsensitive);

    try {
      const responses = await Promise.all(
        nodes.map((node) =>
          concordanceDetachOptions({
            headers: getAuthHeaders(),
            path: { node_id: node.nodeId },
            query: { column: node.column },
            throwOnError: true,
          }).then(({ data }) => data),
        ),
      );
      // Adapt the per-hit detach-options shape for dispersion: hide the
      // CONC_* mandatory columns (the worker computes the dispersion-
      // specific output columns regardless). All optional columns
      // (including the document/text column) start unticked so the user
      // opts in to whatever metadata they want preserved. Also hide
      // `CONC_extraction` — the dispersion-detach worker always emits it
      // as the per-document joined string, so it would be misleading to
      // present it as an opt-in pick (and the dispersion endpoint can't
      // source-select a generated column).
      const dispersionHiddenColumns = new Set<string>([CONCORDANCE_COLUMN_KEYS.extraction]);
      const options = responses
        .flatMap((response) => response.data?.nodes ?? [])
        .map((node) => {
          const disabled = new Set(node.disabled_columns ?? []);
          return {
            ...node,
            available_columns: node.available_columns.filter(
              (c) => !disabled.has(c) && !dispersionHiddenColumns.has(c),
            ),
            disabled_columns: [],
          };
        });
      const initial: Record<string, string[]> = {};
      options.forEach((node) => {
        initial[node.node_id] = [];
      });
      setSelectedDispersionColumns(initial);
      setDispersionDetachOptions(options);
      setDispersionDetachDialogOpen(true);
    } catch (error) {
      console.error('Failed to load dispersion detach options:', error);
      toast.error(
        `Failed to load dispersion detach options: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      setPendingDispersionDetachNodes([]);
      setSelectedDispersionColumns({});
      setPendingDispersionMatchedTexts(null);
      setPendingDispersionCaseInsensitive(false);
    }
  };

  /** Dispatches aggregated dispersion detach requests using the dialog's column and bin choices. */
  /**
   * Called by: ConcordanceFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   * Flow: convert pending bin selections to a set, dispatch each pending dispersion detach with chosen columns and match filters, then reset dialog state.
   */
  const handleDispersionDetachConfirm = async () => {
    const binsSet = pendingDispersionBinSelection ? new Set(pendingDispersionBinSelection) : null;
    for (const n of pendingDispersionDetachNodes) {
      const cols = selectedDispersionColumns[n.nodeId] ?? [];
      await handleDispersionDetach(n.nodeId, n.column, {
        nodeLabel: n.nodeLabel,
        materializedPath: materializedPaths[n.nodeId] ?? null,
        selectedBins: binsSet,
        binCount: pendingDispersionBinCount,
        selectedColumns: cols,
        selectedMatchedTexts: pendingDispersionMatchedTexts,
        matchCaseInsensitive: pendingDispersionCaseInsensitive,
      });
    }
    setDispersionDetachDialogOpen(false);
    setPendingDispersionDetachNodes([]);
    setSelectedDispersionColumns({});
    setDispersionDetachOptions([]);
    setPendingDispersionBinSelection(null);
    setPendingDispersionBinCount(0);
    setPendingDispersionMatchedTexts(null);
    setPendingDispersionCaseInsensitive(false);
  };

  const anyDispersionNodeDetaching = pendingDispersionDetachNodes.some((n) =>
    Boolean(nodeDetaching[n.nodeId]),
  );

  const anyNodeDetaching = pendingDetachNodes.some((n) => Boolean(nodeDetaching[n.nodeId]));

  const pagedResults = results;
  const effHandlePageChange = handlePageChange;
  const effHandleSort = handleSort;
  const effSearchWord = searchWord;
  const effNumLeftTokens = numLeftTokens;
  const effNumRightTokens = numRightTokens;
  const effRegex = regex;
  const effWholeWord = wholeWord;
  const effCaseSensitive = caseSensitive;
  const effSearchMode = searchMode;
  const effViewMode: 'separated' | 'combined' = viewMode;
  const effHandleViewModeChange = handleViewModeChange;

  return (
    <div className="space-y-4">
      <ConcordanceParameterPanel
        nodeInputs={nodeInputs}
        handleColumnChange={handleColumnChange}
        searchWord={effSearchWord}
        setSearchWord={setSearchWord}
        numLeftTokens={effNumLeftTokens}
        setNumLeftTokens={setNumLeftTokens}
        numRightTokens={effNumRightTokens}
        setNumRightTokens={setNumRightTokens}
        regex={effRegex}
        setRegex={setRegex}
        wholeWord={effWholeWord}
        setWholeWord={setWholeWord}
        caseSensitive={effCaseSensitive}
        setCaseSensitive={setCaseSensitive}
        searchMode={effSearchMode}
        setSearchMode={(next) => {
          setSearchMode(next);
          setSearchModeUserSet(true);
        }}
        tokensModeAvailable={tokensModeAvailable}
        renderTokenizerModelSelector={({ nodeId, column }) => (
          <TokenizerModelSelector
            workspaceId={currentWorkspaceId}
            nodeId={nodeId}
            column={column}
            value={effectiveTokenizerModelsByNode[nodeId] ?? ''}
            onChange={(model, detectedLanguage) =>
              { handleTokenizerModelChange(nodeId, column, model, detectedLanguage); }
            }
            getAuthHeaders={getAuthHeaders}
            disabled={false}
            disabledReason="Clear results first to change tokenizer models"
          />
        )}
        isSearching={isSearching}
        actionState={actionState}
        handleRunOrUpdate={handleRunOrUpdate}
        handleStopTask={stopTask}
        isStopping={isStopping}
        handleClearResults={handleClearResults}
      />

      {concordanceWaitingBanner && (
        <AnalysisTaskBanner
          analysisName="Concordance"
          status={concordanceWaitingBanner.status}
          taskId={concordanceWaitingBanner.taskId}
          message={concordanceWaitingBanner.message}
          className="mt-4"
        />
      )}

      {/* Results */}
      {results?.state === 'successful' && (
        <ConcordanceResultsPanel
          results={pagedResults ?? results}
          resultsRef={resultsRef}
          resultsViewportRef={resultsViewportRef}
          resultsViewportWidth={resultsViewportWidth}
          viewMode={effViewMode}
          handleViewModeChange={effHandleViewModeChange}
          combinedLoading={combinedLoading}
          concordanceView={concordanceView}
          setConcordanceView={setConcordanceView}
          showMetadata={showMetadata}
          availableMetadataColumns={availableMetadataColumns}
          metadataColumnSections={metadataColumnSections}
          metadataDisabledReason={metadataDisabledReason}
          selectedMetadataColumns={selectedMetadataColumns}
          setSelectedMetadataColumns={setSelectedMetadataColumns}
          proportionalDispersionBars={proportionalDispersionBars}
          setProportionalDispersionBars={setProportionalDispersionBars}
          combinedSourceMode={combinedSourceMode}
          setCombinedSourceMode={setCombinedSourceMode}
          dispersionChartType={dispersionChartType}
          setDispersionChartType={setDispersionChartType}
          selectedBinIndices={selectedBinIndices}
          onBinSelect={handleBinSelect}
          onClearBinSelection={handleClearBinSelection}
          colourMatches={colourMatches}
          setColourMatches={setColourMatches}
          lowercaseMatches={lowercaseMatches}
          setLowercaseMatches={setLowercaseMatches}
          hiddenMatchedTexts={hiddenMatchedTexts}
          setHiddenMatchedTexts={setHiddenMatchedTexts}
          binCount={binCount}
          setBinCount={handleBinCountChange}
          allMatchedTexts={allMatchedTexts}
          matchedTextColorMap={matchedTextColorMap}
          getMaterializedBinsForKey={getMaterializedBinsForKey}
          isBlockMaterialised={isBlockMaterialised}
          searchWord={effSearchWord}
          selectedNodes={selectedNodes}
          panelSelectedNodes={panelSelectedNodes}
          effectiveNodeColumnSelections={effectiveNodeColumnSelections}
          labelToNodeId={labelToNodeId}
          sourceColorMap={sourceColorMap}
          defaultPalette={defaultPalette}
          nodePagination={nodePagination}
          globalPageSize={globalPageSize}
          onPageSizeChange={handleGlobalPageSizeChange}
          combinedPage={combinedPage}
          setCombinedPage={setCombinedPage}
          nodeLoading={nodeLoading}
          nodeDetaching={nodeDetaching}
          nodeMaterializing={nodeMaterializing}
          materializedPaths={materializedPaths}
          materializeSummaries={materializeSummaries}
          handleSort={effHandleSort}
          handlePageChange={effHandlePageChange}
          handleRowClick={handleRowClick}
          handleMaterialize={handleMaterialize}
          openDetachDialog={(nodes) => {
            void openDetachDialog(nodes);
          }}
          onDispersionDetach={openDispersionDetachDialog}
          readOnly={false}
        />
      )}

      {results?.state === 'failed' && (
        <Card>
          <CardContent>
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {results.message}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail Modal */}
      <RowDetailPanel
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payload={detailPayload}
        customization={concordanceCustomization}
      />

      {/* Loading State */}
      {isLoading.graph && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-600 mt-2">Loading workspace...</p>
        </div>
      )}

      {/* Dispersion (per-document aggregated) detach column dialog */}
      <ConcordanceDispersionDetachDialog
        open={dispersionDetachDialogOpen}
        onOpenChange={setDispersionDetachDialogOpen}
        isDetaching={anyDispersionNodeDetaching}
        detachNodeOptions={dispersionDetachOptions}
        selectedDetachColumns={selectedDispersionColumns}
        toggleDetachColumn={toggleDispersionColumn}
        selectAllDetachColumns={selectAllDispersionColumns}
        deselectAllDetachColumns={deselectAllDispersionColumns}
        handleDetachConfirm={handleDispersionDetachConfirm}
      />

      {/* Detach column selection dialog */}
      <ConcordanceDetachDialog
        open={detachDialogOpen}
        onOpenChange={setDetachDialogOpen}
        isDetaching={anyNodeDetaching}
        detachNodeOptions={detachNodeOptions}
        selectedDetachColumns={selectedDetachColumns}
        toggleDetachColumn={toggleDetachColumn}
        selectAllDetachColumns={selectAllDetachColumns}
        deselectAllDetachColumns={deselectAllDetachColumns}
        handleDetachConfirm={handleDetachConfirm}
      />
    </div>
  );
}

export { ConcordanceFeature };
export default ConcordanceFeature;
