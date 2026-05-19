import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useAuth } from '@/hooks/useAuth';
import useNodeColumnInfos from '@/hooks/useNodeColumnInfos';
import { type ConcordanceAnalysisResponse, type ConcordanceDispersionBinRow, type ConcordanceGroupedRow, textApi } from '@/api/text';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { Card, CardContent } from '@/components/ui/card';
import AnalysisTaskBanner from '@/features/analysis/common/components/AnalysisTaskBanner';
import type { MultiSeriesChartType } from '@/features/analysis/common/components/MultiSeriesChart';
import {
  hasLockedParameterDiff,
  resetAnalysisSelectionAfterClear,
  restoreAnalysisLockFromRequest,
  useAnalysisLock,
  useAnalysisFeature,
  useNodeColorManagement,
  useSafeResult,
  EXTENDED_PALETTE,
  getAnalysisActionState,
  executeAnalysisRunOrUpdate,
} from '../common';
import type { WorkspaceNodeLike } from '../common/nodeSelectionTypes';
import {
  pruneTasksById,
} from '@/hooks/analysisTaskUtils';
import { useConcordanceTaskFlow, type PaginationState } from './hooks/useConcordanceTaskFlow';
import { computeTokensModelIntersection } from './tokensModelIntersection';
import { effectiveNodeLanguage } from '@/lib/effectiveNodeLanguage';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useConcordanceMetadataColumns } from './hooks/useConcordanceMetadataColumns';
import { useConcordanceMaterializedEvents } from './hooks/useConcordanceMaterializedEvents';
import { useConcordancePendingHandoff } from './hooks/useConcordancePendingHandoff';
import { useConcordanceViewModeSwap } from './hooks/useConcordanceViewModeSwap';
import {
  SNAPSHOT_CAPS,
  isSnapshotMode,
  useToolSnapshotMode,
} from '@/features/snapshot-view';
import { useConcordanceSnapshotCapture } from './hooks/useConcordanceSnapshotCapture';
import { useConcordanceSnapshotLoad } from './hooks/useConcordanceSnapshotLoad';
import { ConcordanceSnapshotBanner } from './components/ConcordanceSnapshotBanner';
import { useSnapshotViewStore } from '@/features/snapshot-view';
import type { LoadedSnapshot } from '@/features/snapshot-view';
import type { ConcordanceSnapshotPayload } from './hooks/useConcordanceSnapshotLoad';
import type { ConcordanceAnalysisRequest, ConcordanceResultEntry } from '@/api/text/concordance';
import { ConcordanceParameterPanel } from './components/ConcordanceParameterPanel';
import { ConcordanceResultsPanel } from './components/ConcordanceResultsPanel';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../common/components/useRowDetailDialog';
import { highlightMatchInText } from '../common/components/highlightText';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ConcordanceDetachDialog } from './components/ConcordanceDetachDialog';
import { ConcordanceDispersionDetachDialog } from './components/ConcordanceDispersionDetachDialog';
import type { DetachDialogNodeOption } from '../components/DetachColumnsDialog';
import { useDetachColumnsState } from '../common/hooks/useDetachColumnsState';
import {
  DISPERSION_DEFAULT_BIN_COUNT,
  type DispersionDisplayBinCount,
  type TaggedBinRow,
} from './concordanceViewModels';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_CORE_COLUMNS,
  CONCORDANCE_FREQ_COLUMNS,
} from '../generatedColumns';


const CORE_COLS = [...CONCORDANCE_CORE_COLUMNS];
const FREQ_COLS = [...CONCORDANCE_FREQ_COLUMNS];
const ALL_CONC_COLS_SET = new Set<string>([...CORE_COLS, ...FREQ_COLS]);



const ConcordanceFeature: React.FC = () => {
  // Anchor ref for results container to stabilize scroll on view mode toggle
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { selectedNodes } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const { currentWorkspaceId, currentWorkspace } = useWorkspaceData();
  const {
    detachConcordance,
    detachConcordanceDispersion,
    materializeConcordance,
    selectNodes,
  } = useWorkspaceActions();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'concordance';
  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const {
    isLocked,
    lockWithSnapshots,
    unlockSelection,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
    activeNodeColumnSelections,
    activeNodeIds,
    panelSelectedNodes: livePanelSelectedNodes,
    displayNodeCount,
    serverRequest,
  } = useAnalysisLock({
    analysisType: 'concordance_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    allowedDataTypes: ['string'],
    maxNodes: 2,
    docTypeOnly: true,
  });
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
  // Phase 4.7: concordance has two engines. ``regex`` walks raw text (the
  // historical default, preserves ``equ\w*``-style affordances); ``tokens``
  // walks the active node's derived tokens column for N-actual-token CJK-
  // aware context (decision 6). Auto-picked below when the active node
  // has been tokenised AND the user hasn't manually overridden.
  const [searchMode, setSearchMode] = useState<'regex' | 'tokens'>('regex');
  const [searchModeUserSet, setSearchModeUserSet] = useState(false);
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  // Metadata visibility derives from the selected columns: any selection
  // shows the corresponding metadata columns in the results table.
  const showMetadata = selectedMetadataColumns.length > 0;
  const [concordanceView, setConcordanceView] = useState<'table' | 'dispersion'>('table');
  const showDispersion = concordanceView === 'dispersion';
  const [proportionalDispersionBars, setProportionalDispersionBars] = useState(false);
  // L1/R1 cell text colour. Defaults to `transparent` so the duplicate
  // tokens are hidden out of the box — the L1/R1 columns are still
  // there as sort handles, but their text doesn't compete with the
  // wider context cells. The user opts in via "Show L1/R1" on the
  // result panel; the colour picker only appears once they do.
  const [nearestTokenColor, setNearestTokenColor] = useState<string>('transparent');
  const [colourMatches, setColourMatches] = useState(false);
  const [lowercaseMatches, setLowercaseMatches] = useState(false);
  const [hiddenMatchedTexts, setHiddenMatchedTexts] = useState<Set<string>>(new Set());
  const [binCount, setBinCount] = useState<DispersionDisplayBinCount>(DISPERSION_DEFAULT_BIN_COUNT);
  const [combinedSourceMode, setCombinedSourceMode] = useState<'aggregate' | 'split'>('aggregate');
  const [dispersionChartType, setDispersionChartType] =
    useState<MultiSeriesChartType>('line');
  const [selectedBinIndices, setSelectedBinIndices] = useState<
    Record<string, Set<number>>
  >({});
  const lastSelectedBinRef = useRef<Record<string, number | null>>({});
  const handleBinSelect = useCallback(
    (blockKey: string, index: number, shiftHeld: boolean) => {
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
    },
    [],
  );
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
  const handleBinCountChange = useCallback(
    (value: DispersionDisplayBinCount) => {
      setBinCount(value);
      setSelectedBinIndices((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      lastSelectedBinRef.current = {};
    },
    [],
  );
  const [liveMaterializedBins, setMaterializedBins] = useState<Record<string, ConcordanceDispersionBinRow[]>>({});
  // Declared early so the position-fetch effect / lookups can reference it.
  // The setter is also used further below by the materialise-task watcher.
  const [liveMaterializedPaths, setMaterializedPaths] = useState<Record<string, string>>({});
  const [resultsViewportWidth, setResultsViewportWidth] = useState(0);
  const [liveResults, concordanceResultsRef, _setResultSafely, setResults] = useSafeResult<ConcordanceAnalysisResponse>();
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);

  // Snapshot view mode for this tool. ``live`` in every code path
  // until the user opens a snapshot from the Load dialog. Hoisted
  // up here (above all useMemos that depend on panelSelectedNodes /
  // results / materializedPaths / materializedBins) so the effective
  // dispatch can shadow those names at one site, propagating the
  // captured data through the rest of the component verbatim.
  const snapshotMode = useToolSnapshotMode('concordance');
  const loadedSnapshot = useSnapshotViewStore(
    (s) => s.snapshots.concordance,
  ) as LoadedSnapshot<ConcordanceSnapshotPayload> | null;
  const inSnapshotMode = isSnapshotMode(snapshotMode) && loadedSnapshot != null;

  // Effective-value dispatch: when in snapshot mode, every downstream
  // useMemo / hook / JSX prop reads from the captured snapshot instead
  // of live state. Live state stays untouched so Exit returns the user
  // to exactly where they were. The shadowed names (panelSelectedNodes,
  // results, materializedPaths, materializedBins) are read by the rest
  // of the component as-is — making this a single dispatch point
  // rather than a sprawl of conditionals across every reference site.
  // See plan §10 (Snapshot view) for the architecture rationale: a
  // snapshot is "the live UI with frozen data + mutation guards", not
  // a parallel viewer.
  const panelSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return livePanelSelectedNodes;
    const {
      node_ids,
      node_labels,
      per_block_rows,
      total_source_rows,
    } = loadedSnapshot.manifest.source;
    const evenSplit =
      node_ids.length > 0 ? Math.floor(total_source_rows / node_ids.length) : 0;
    return node_ids.map((id, idx) => ({
      id,
      node_id: id,
      name: node_labels[idx] ?? id,
      shape: [per_block_rows?.[idx] ?? evenSplit, 0] as [number, number],
    }));
  }, [inSnapshotMode, loadedSnapshot, livePanelSelectedNodes]);

  const results = useMemo<ConcordanceAnalysisResponse | null>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return liveResults;
    const captured = loadedSnapshot.payload.resultByNodeId;
    return {
      state: 'successful',
      message: '',
      data: captured,
      metadata: {},
      // ``__COMBINED__`` entry only present in the bundle if the
      // original analysis was run with ``combined: true``. Surfacing
      // ``combinable`` from that drives the Separated/Combined tab
      // toggle in <ConcordanceResultsPanel>.
      combinable: '__COMBINED__' in captured,
    };
  }, [inSnapshotMode, loadedSnapshot, liveResults]);

  const materializedPaths = useMemo<Record<string, string>>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return liveMaterializedPaths;
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(loadedSnapshot.payload.resultByNodeId)) {
      if (entry.materialized) out[id] = `snapshot:${id}`;
    }
    return out;
  }, [inSnapshotMode, loadedSnapshot, liveMaterializedPaths]);

  const materializedBins = useMemo<Record<string, ConcordanceDispersionBinRow[]>>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return liveMaterializedBins;
    const out: Record<string, ConcordanceDispersionBinRow[]> = {};
    for (const [id, resp] of Object.entries(loadedSnapshot.payload.binsByNodeId)) {
      out[id] = resp.rows;
    }
    return out;
  }, [inSnapshotMode, loadedSnapshot, liveMaterializedBins]);
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

  // Color management & view mode. ``tabKey`` routes the colour
  // changes through the per-tab temp layer so the picker preview
  // doesn't immediately rewrite the assigned colours other tabs +
  // graph + sidebar are showing. ``promoteTempColors`` is fired
  // below in ``handleRunOrUpdate`` to commit the pending temps to
  // assigned when the user actually runs the analysis.
  const { nodeColors: liveNodeColors, handleColorChange, defaultPalette, promoteTempColors } =
    useNodeColorManagement({
      activeNodeIds,
      palette: EXTENDED_PALETTE,
      tabKey: 'concordance',
    });
  // In snapshot mode the live colour store has no entries for the
  // captured node IDs. Shadow with the frozen ``manifest.node_colors``
  // so swatches, legends, and chart series read the captured colour.
  const nodeColors: Record<string, string> =
    inSnapshotMode && loadedSnapshot ? loadedSnapshot.manifest.node_colors : liveNodeColors;

  const concordanceTaskId = useMemo(() => {
    const md = (liveResults as ConcordanceAnalysisResponse | null)?.metadata as
      | Record<string, unknown>
      | undefined;
    const value = md?.task_id ?? md?.taskId;
    return typeof value === 'string' ? value : '';
  }, [liveResults]);

  const resolveNodeIdForKey = useCallback((nodeKey: string): string | null => {
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
  }, [panelSelectedNodes, labelToNodeId]);

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
    const effectiveTaskId = concordanceTaskId || concordanceTaskIdRef.current;
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
          const resp = await textApi.getConcordanceTaskDispersionBins(
            effectiveTaskId,
            nodeId,
            authHeaders,
          );
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
  }, [showDispersion, proportionalDispersionBars, concordanceTaskId, materializedPaths, panelSelectedNodes]);

  const isBlockMaterialised = (nodeKey: string): boolean => {
    const ids = relevantNodeIdsForKey(nodeKey);
    return ids.length > 0 && ids.every((id) => id in materializedPaths);
  };

  const getMaterializedBinsForKey = (
    nodeKey: string,
  ): TaggedBinRow[] | undefined => {
    const ids = relevantNodeIdsForKey(nodeKey);
    if (ids.length === 0) return undefined;
    if (!ids.every((id) => id in materializedPaths)) return undefined;
    if (!ids.every((id) => id in materializedBins)) return undefined;
    const tagged: TaggedBinRow[] = [];
    for (const id of ids) {
      const node = panelSelectedNodes.find((n: WorkspaceNodeLike) => n.id === id);
      const sourceLabel = (node?.name as string | undefined) ?? id;
      for (const row of materializedBins[id]!) {
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
          const raw = String(row.matched_text ?? '');
          if (raw) seen.add(lowercaseMatches ? raw.toLowerCase() : raw);
        }
        continue;
      }
      for (const group of nodeData.data) {
        for (const hit of group) {
          const raw = String(hit[CONCORDANCE_COLUMN_KEYS.matchedText] ?? '');
          if (raw) seen.add(lowercaseMatches ? raw.toLowerCase() : raw);
        }
      }
    }
    return [...seen].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDispersion, colourMatches, lowercaseMatches, results?.data, materializedBins, materializedPaths, panelSelectedNodes]);

  const matchedTextColorMap = useMemo(
    (): Record<string, string> =>
      Object.fromEntries(allMatchedTexts.map((t, i) => [t, EXTENDED_PALETTE[i % EXTENDED_PALETTE.length]!])),
    [allMatchedTexts],
  );

  const [viewMode, setViewMode] = useState<'separated'|'combined'>('separated');
  const [combinedPage, setCombinedPage] = useState(1);
  // Separate snapshot-mode viewMode so toggling Separated/Combined
  // while viewing a snapshot doesn't pollute live state on Exit.
  // Initialised below from the captured ``settings.combined`` flag.
  const [snapshotViewMode, setSnapshotViewMode] =
    useState<'separated'|'combined'>('separated');

  useEffect(() => {
    const element = resultsViewportRef.current;
    if (!element) {
      return;
    }

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
  // In snapshot mode the selections come from the captured
  // ConcordanceAnalysisRequest's ``node_columns`` so the live UI's
  // column dropdowns render the captured column without re-fetching it.
  const effectiveNodeColumnSelections = useMemo(() => {
    if (inSnapshotMode && loadedSnapshot?.payload.settings?.node_columns) {
      return Object.entries(loadedSnapshot.payload.settings.node_columns).map(
        ([nodeId, column]) => ({ nodeId, column }),
      );
    }
    return isLocked ? activeNodeColumnSelections : nodeColumnSelections;
  }, [inSnapshotMode, loadedSnapshot, isLocked, activeNodeColumnSelections, nodeColumnSelections]);

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
      const candidateIds = [
        node.id,
        node.node_id,
      ].map((val) => (typeof val === 'string' ? val : null)).filter(Boolean) as string[];
      const primaryId = candidateIds[0] ?? `node-${idx}`;
      const assigned = (nodeColors[primaryId] || defaultPalette[idx % defaultPalette.length])!;
      const variants = new Set<string>();
      [
        primaryId,
        node.name,
        node.name,
        node.label,
        node.label,
      ].forEach((value) => {
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

  // Phase 4.7: check whether any selected node has a derived tokens
  // column matching the column the user picked, so tokens-mode is only
  // offered when it makes sense. We look at the first node's selection
  // and its ``derived`` metadata.
  const defaultLanguage = usePreferencesStore((state) => state.defaultLanguage);
  const tokensModeAvailable = useMemo(() => {
    const firstSelection = effectiveNodeColumnSelections[0];
    if (!firstSelection?.column) return false;
    const firstNode = panelSelectedNodes.find((n: WorkspaceNodeLike) => {
      const ids = [n.id, n.node_id];
      return ids.some(
        (id) => typeof id === 'string' && id === firstSelection.nodeId,
      );
    });
    const derived = firstNode?.derived;
    if (!derived || typeof derived !== 'object') return false;
    return Object.values(derived as Record<string, unknown>).some((meta) => {
      if (!meta || typeof meta !== 'object') return false;
      const sourceColumn = (meta as { source_column?: unknown }).source_column;
      const form = (meta as { form?: unknown }).form;
      return form === 'tokens' && sourceColumn === firstSelection.column;
    });
  }, [effectiveNodeColumnSelections, panelSelectedNodes]);

  // Auto-pick tokens-mode when it becomes available AND the user hasn't
  // manually overridden. When tokens stop being available (e.g. user
  // switches to a data block without a derived tokens column) force
  // regex and clear the user-override flag — the override was
  // contextual to a node/column selection that no longer holds, and
  // leaving it sticky lets stale 'tokens' survive onto an ineligible
  // block, where Run then errors at the backend.
  useEffect(() => {
    if (!tokensModeAvailable) {
      setSearchMode('regex');
      setSearchModeUserSet(false);
      return;
    }
    if (searchModeUserSet) return;
    setSearchMode('tokens');
  }, [tokensModeAvailable, searchModeUserSet]);

  // Tokens-models the picker can offer for a tokens-mode search across the
  // current node selection. See ``computeTokensModelIntersection`` for the
  // intersection rationale (Bug 1: pre-fix the picker was computed off the
  // first selected node only, which silently mis-routed the JA node to
  // jieba and made materialize 400 on mixed-language selections).
  const tokensModelOptions = useMemo<string[]>(
    () =>
      computeTokensModelIntersection(
        effectiveNodeColumnSelections,
        panelSelectedNodes,
      ),
    [effectiveNodeColumnSelections, panelSelectedNodes],
  );

  const [tokensModel, setTokensModel] = useState<string | null>(null);
  // Auto-pick when only one model exists; clear when no models OR when the
  // current pick is no longer in the option list (the user might have
  // deleted that derivation via Manage tokens…).
  useEffect(() => {
    if (tokensModelOptions.length === 0) {
      if (tokensModel !== null) setTokensModel(null);
      return;
    }
    if (tokensModelOptions.length === 1) {
      const only = tokensModelOptions[0]!;
      if (tokensModel !== only) setTokensModel(only);
      return;
    }
    if (tokensModel === null || !tokensModelOptions.includes(tokensModel)) {
      setTokensModel(tokensModelOptions[0] ?? null);
    }
  }, [tokensModelOptions, tokensModel]);

  const concordanceLanguage = useMemo(() => {
    const firstSelection = effectiveNodeColumnSelections[0];
    const firstNode = firstSelection
      ? panelSelectedNodes.find((n: WorkspaceNodeLike) =>
          [n.id, n.node_id].some(
            (id) => typeof id === 'string' && id === firstSelection.nodeId,
          ),
        )
      : undefined;
    return effectiveNodeLanguage({
      node: firstNode ?? null,
      defaultLanguage,
    });
  }, [effectiveNodeColumnSelections, panelSelectedNodes, defaultLanguage]);

  // Pagination and sorting state - separate for each node
  const [nodePagination, setNodePagination] = useState<PaginationState>({});
  
  // Individual node loading states for pagination/sorting (separate from main search)
  const [nodeLoading, setNodeLoading] = useState<Record<string, boolean>>({});
  
  // Individual node detaching states
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});

  // Individual node materializing states and tracked task ids
  const [nodeMaterializing, setNodeMaterializing] = useState<Record<string, boolean>>({});
  const [materializeTaskIds, setMaterializeTaskIds] = useState<Record<string, string>>({});
  const [materializeSummaries, setMaterializeSummaries] = useState<Record<string, { recordCount: number; uniqueDocuments: number; totalDocuments: number }>>({});
  
  // Detach dialog state
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [pendingDetachNodes, setPendingDetachNodes] = useState<{ nodeId: string; column: string; nodeLabel: string }[]>([]);
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
  const [pendingDispersionDetachNodes, setPendingDispersionDetachNodes] = useState<{ nodeId: string; column: string; nodeLabel: string }[]>([]);
  const [dispersionDetachOptions, setDispersionDetachOptions] = useState<DetachDialogNodeOption[]>([]);
  const [pendingDispersionBinSelection, setPendingDispersionBinSelection] = useState<number[] | null>(null);
  const [pendingDispersionBinCount, setPendingDispersionBinCount] = useState<number>(0);
  const [pendingDispersionMatchedTexts, setPendingDispersionMatchedTexts] = useState<string[] | null>(null);
  const [pendingDispersionCaseInsensitive, setPendingDispersionCaseInsensitive] = useState<boolean>(false);
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
  const { detailPayload, detailOpen, setDetailOpen, openDetail: openRowDetail } = useRowDetailDialog();
  const [concordanceDetailExtra, setConcordanceDetailExtra] = useState<{
    concordanceHits: Array<Record<string, unknown>>;
    caseSensitive: boolean;
  } | null>(null);
  
  const {
    resolveTaskId,
    setLocalTaskId: setLocalConcordanceTaskId,
    isRunning: isSearching,
    setIsRunning: setIsSearching,
    taskStatus: concordanceTaskStatus,
    banner: concordanceWaitingBanner,
    hasActiveTask,
    hydrationState,
    clearResults,
  } = useAnalysisFeature<ConcordanceAnalysisResponse>({
    analysisType: 'concordance_analysis',
    taskType: 'concordance',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef: concordanceResultsRef,
    fetchResult: async (taskId, headers) =>
      textApi.getConcordanceTaskResult(taskId, headers),
    fetchRequest: async (taskId, headers) =>
      textApi.getConcordanceTaskRequest(taskId, headers),
    onResultFetched: (resultData) => {
      if (resultData) {
        setResults(resultData as ConcordanceAnalysisResponse);
      }
    },
    onHydratedResult: (resultPayload) => {
      const res = resultPayload?.data ?? resultPayload;
      if (res) {
        setResults(resultPayload as ConcordanceAnalysisResponse);
      }
    },
    onHydratedRequest: async (requestPayload) => {
      const req = (requestPayload as Record<string, unknown>)?.data ?? requestPayload;
      if (!req || typeof req !== 'object') return;
      const reqObj = req as Record<string, unknown>;
      const nodeIds: string[] = Array.isArray(reqObj.node_ids) ? reqObj.node_ids.slice(0, 2) : [];
      const node_columns: Record<string, string> = (reqObj.node_columns as Record<string, string>) || {};
      const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
      setNodeColumnSelections(sels, { replace: true });
      setSearchWord(String(reqObj.search_word || ''));
      setNumLeftTokens(Number(reqObj.num_left_tokens ?? 10));
      setNumRightTokens(Number(reqObj.num_right_tokens ?? 10));
      const hydratedRegex = !!reqObj.regex;
      setRegex(hydratedRegex);
      setWholeWord(hydratedRegex ? false : typeof reqObj.whole_word === 'boolean' ? reqObj.whole_word : true);
      setCaseSensitive(!!reqObj.case_sensitive);
      const hydratedMode: 'separated' | 'combined' = reqObj.combined && reqObj.combinable !== false ? 'combined' : 'separated';
      setViewMode(hydratedMode);
      // Replace (not merge) on hydration so the saved task's materialised
      // state is the source of truth. Otherwise stale entries from a
      // previous task could survive a re-run that produced an empty
      // `materialized_paths`, leaving the Process All button incorrectly
      // disabled and the bin-fetch hitting "No materialised concordance for
      // node X" 404s. Also reset the bin cache + applied-event tracker so
      // the consumer + bin-fetch effects re-populate cleanly for whatever
      // the hydrated task contains.
      const paths = reqObj.materialized_paths as Record<string, string> | undefined;
      const nextPaths = (paths && typeof paths === 'object') ? { ...paths } : {};
      setMaterializedPaths(nextPaths);
      setMaterializedBins({});
      resetProcessedEvents();
      const summaries = reqObj.materialize_summaries as Record<string, Record<string, unknown>> | undefined;
      const nextSummaries: Record<string, { recordCount: number; uniqueDocuments: number; totalDocuments: number }> = {};
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
      try {
        await restoreAnalysisLockFromRequest({
          workspaceId: currentWorkspaceId,
          requestData: req,
          getAuthHeaders,
          lockWithSnapshots,
          queryClient,
          maxNodes: 2,
        });
      } catch { /* ignore */ }
    },
    onCleared: (_, options) => {
      setResults(null);
      setNodePagination({});
      setCombinedPage(1);
      setMaterializeSummaries({});
      if (options?.preserveLocalState) {
        return;
      }
      resetAnalysisSelectionAfterClear({ unlockSelection });
    },
    pruneGlobalTasks: (taskIds) => {
      setTasks((prev) => {
        if (!Array.isArray(prev)) return prev;
        return taskIds.length > 0 ? pruneTasksById(prev, taskIds) : prev;
      });
    },
    isResultRunning: (r) => r?.state === 'running',
  });

  // Snapshot capture handler. Lives below useAnalysisFeature so we
  // can consult ``concordanceTaskStatus.successfulTask?.task_id`` —
  // the most-recent successful task ID, which stays stable across
  // Process All / materialise (when ``results.metadata.task_id``
  // can drop to null).
  //
  // Materialise also triggers a refetch that briefly nukes every
  // live source (taskStatus.successfulTask, terminalTask, and
  // results.metadata.task_id all empty for the same render).
  // Latch the latest non-empty value into a ref — same pattern
  // ``concordanceTaskIdRef`` already uses for the bin fetcher
  // (see useConcordanceMaterializedEvents).
  const liveCaptureTaskId =
    concordanceTaskStatus.successfulTask?.task_id ||
    concordanceTaskStatus.terminalTask?.task_id ||
    concordanceTaskId ||
    '';
  const latestCaptureTaskIdRef = useRef<string>('');
  useEffect(() => {
    if (liveCaptureTaskId) latestCaptureTaskIdRef.current = liveCaptureTaskId;
  }, [liveCaptureTaskId]);
  const captureTaskId = liveCaptureTaskId || latestCaptureTaskIdRef.current;

  const getConcordanceNodeRowCount = useCallback((node: WorkspaceNodeLike) => {
    const shape = node.shape as unknown;
    if (Array.isArray(shape) && typeof shape[0] === 'number') return shape[0];
    return 0;
  }, []);

  // Snapshot load handler. Wired through the LoadSnapshotDialog →
  // SnapshotActions → AnalysisFeatureHeader chain. Phase 1b-2a
  // populates the snapshot store + shows the banner; the dual-source
  // result rendering ships in Phase 1b-2b.
  const handleOpenSnapshot = useConcordanceSnapshotLoad();

  // Build the actual ConcordanceAnalysisRequest from the live form
  // state so the captured ``settings.json`` reconstructs the search
  // params exactly. Live results.metadata carries the task id but
  // not the request shape — using it here is what produced the
  // "Search term: unknown" bug in v0.4.4 snapshots.
  const captureRequest = useMemo<ConcordanceAnalysisRequest | null>(() => {
    if (panelSelectedNodes.length === 0) return null;
    const nodeIds: string[] = [];
    const nodeColumns: Record<string, string> = {};
    for (const node of panelSelectedNodes) {
      const id = node.id ?? (node.node_id as string | undefined);
      if (!id) continue;
      nodeIds.push(id);
      const sel = effectiveNodeColumnSelections.find((s) => s.nodeId === id);
      if (sel?.column) nodeColumns[id] = sel.column;
    }
    if (nodeIds.length === 0) return null;
    return {
      node_ids: nodeIds,
      node_columns: nodeColumns,
      search_word: searchWord,
      num_left_tokens: numLeftTokens,
      num_right_tokens: numRightTokens,
      regex,
      whole_word: wholeWord,
      case_sensitive: caseSensitive,
      combined: viewMode === 'combined',
      search_mode: searchMode,
      ...(tokensModel ? { model: tokensModel } : {}),
      ...(concordanceLanguage ? { language: concordanceLanguage } : {}),
    };
  }, [
    panelSelectedNodes,
    effectiveNodeColumnSelections,
    searchWord,
    numLeftTokens,
    numRightTokens,
    regex,
    wholeWord,
    caseSensitive,
    viewMode,
    searchMode,
    tokensModel,
    concordanceLanguage,
  ]);

  const handleSaveSnapshot = useConcordanceSnapshotCapture({
    workspaceId: currentWorkspaceId ?? null,
    workspaceName: currentWorkspace?.name ?? currentWorkspaceId ?? '(workspace)',
    taskId: captureTaskId,
    request: captureRequest,
    selectedNodes: panelSelectedNodes,
    getNodeRowCount: getConcordanceNodeRowCount,
    getAuthHeaders,
  });

  // Synchronous Save-button disable reason. Mirrors the capture
  // hook's guards so the user sees the explanation BEFORE opening
  // the dialog (matches the runDisabledReason / DisabledReasonTooltip
  // pattern used by the Run button). Returned as ``undefined`` when
  // Save should be enabled.
  const saveSnapshotDisabledReason = (() => {
    if (inSnapshotMode) {
      return 'Exit snapshot view first to capture a new snapshot from live results.';
    }
    if (panelSelectedNodes.length === 0) {
      return 'Select at least one data block first.';
    }
    const counts = panelSelectedNodes.map(getConcordanceNodeRowCount);
    const largest = counts.reduce((m, n) => (n > m ? n : m), 0);
    const cap = SNAPSHOT_CAPS.demo.maxSourceRowsPerBlock;
    if (cap !== null && largest > cap) {
      return `Largest selected data block has ${largest.toLocaleString()} rows; demo snapshots cap each block at ${cap.toLocaleString()}.`;
    }
    if (!captureTaskId) {
      return 'Run the concordance analysis (and let it finish) before saving a snapshot.';
    }
    // Hard-require materialise: the snapshot ships the flat
    // materialised shape so re-binning + the full hit list render
    // identically at load time. An unmaterialised result would ship
    // the rich paginated shape (~4× larger) and the load-side
    // viewer would need a separate code path to render it.
    if (!results || results.state !== 'successful') {
      return 'Wait for the concordance analysis to finish before saving a snapshot.';
    }
    const selectedIds = panelSelectedNodes
      .map((n) => n.id ?? (n.node_id as string | undefined))
      .filter((id): id is string => Boolean(id));
    // Check ``materializedPaths`` (the SSE-tracked per-node state)
    // rather than ``results.data[id].materialized``: in combined-view
    // mode the response only carries the ``__COMBINED__`` entry, so
    // the per-node ``materialized`` flags don't exist there at all,
    // which would incorrectly disable Save even after Process Both
    // successfully materialised both nodes.
    const unmaterialised = selectedIds.filter(
      (id) => !materializedPaths[id],
    );
    if (unmaterialised.length > 0) {
      return `Click Process All to materialise ${unmaterialised.length === 1 ? 'the result' : 'all selected data blocks'} before saving — keeps the snapshot compact and enables re-binning of the dispersion chart.`;
    }
    return undefined;
  })();

  // (effectiveNodeColumnSelections is declared above so it can be referenced
  // by the metadata-column section IIFE.)

  // No auto-selection on activation: Show metadata starts empty and the user
  // explicitly ticks the columns they want. We just clean up any selections
  // that are no longer in the available set (e.g. after a re-run that drops
  // a column from the source data).
  useEffect(() => {
    setSelectedMetadataColumns((prev) => {
      const filtered = prev.filter((column) => availableMetadataColumns.includes(column));
      if (filtered.length === prev.length) return prev;
      return filtered;
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
      isLocked,
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
      language: concordanceLanguage,
      model: tokensModel,
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
    },
    lock: {
      getAuthHeaders,
      lockWithSnapshots,
      resolveTaskId,
      detachConcordance,
      detachConcordanceDispersion,
      materializeConcordance,
      queryClient,
    },
  });

  const hasLockedParameterChanges = hasLockedParameterDiff({
    isLocked,
    serverRequest: (serverRequest as Record<string, unknown> | null) ?? null,
    currentParams: {
      search_word: searchWord,
      num_left_tokens: numLeftTokens,
      num_right_tokens: numRightTokens,
      regex,
      whole_word: wholeWord,
      case_sensitive: caseSensitive,
    },
    getServerParams: (request) => ({
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
    }),
  });

  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: panelSelectedNodes.length > 0,
    isLocked,
    hasResults: Boolean(results),
    isBusy: isSearching,
    hasActiveTask,
    allowRunWhenLocked: hasLockedParameterChanges,
    canUpdate: true,
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
    // Snapshot mode: the captured result's pagination.page_size reflects
    // the ``page_size: 'all'`` capture path (500 000 cap), NOT the user's
    // viewing preference. Pulling that into globalPageSize would put
    // every captured row on one mega-page. Skip the sync entirely —
    // snapshot rendering uses globalPageSize as the client-side slice
    // window (default 20), and the user can still change it via the
    // PageSizeSelect dropdown in the parameter panel.
    if (inSnapshotMode) return;
    // Only sync preferences on the first result load (hydration).
    if (prefsSyncedRef.current) return;
    prefsSyncedRef.current = true;

    const analysisParams = results?.analysis_params ?? {};
    const preferenceSource = results?.preferences ?? (analysisParams as Record<string, unknown>)?.preferences as Record<string, unknown> | undefined ?? {};

    // Fall back to the first node's resolved pagination.page_size (which reflects
    // server-side estimation) when the analysis params don't carry it.
    const firstNodeEntry = results?.data
      ? Object.values(results.data)[0]
      : undefined;
    const firstNodePageSize = firstNodeEntry?.pagination?.page_size;

    const nextPageSize = preferenceSource?.page_size ?? analysisParams?.page_size ?? firstNodePageSize;
    if (typeof nextPageSize === 'number' && Number.isFinite(nextPageSize) && nextPageSize > 0 && nextPageSize !== globalPageSize) {
      // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
      const id = requestAnimationFrame(() => {
        setGlobalPageSize(nextPageSize);
        setNodePagination(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach((nodeId) => {
            updated[nodeId] = {
              ...updated[nodeId]!,
              pageSize: nextPageSize,
            };
          });
          return updated;
        });
      });
      return () => cancelAnimationFrame(id);
    }

  }, [results, globalPageSize, setNodePagination, inSnapshotMode]);

  // Materialize lifecycle: terminal-state task watcher, task-id ref reset,
  // and `analysis_materialized` SSE consumer. See hook for details.
  const { concordanceTaskIdRef, resetProcessedEvents } = useConcordanceMaterializedEvents({
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

  // Preserve results across transient graph refetches: only clear when the actual set of selected IDs changes
  const selectedNodeIds = selectedNodes.map((node) => node.id).sort();
  const selectedNodeIdsKey = selectedNodeIds.join('|');
  const prevSelectedNodeIdsRef = React.useRef<string[] | null>(null);
  useEffect(() => {
    const prev = prevSelectedNodeIdsRef.current;
    const curr = selectedNodeIds;
    const changed = !prev || prev.length !== curr.length || prev.some((id, i) => id !== curr[i]);
    if (changed && !isLocked) {
      setResults(null);
    }
    prevSelectedNodeIdsRef.current = curr;
  }, [selectedNodeIdsKey, isLocked, selectedNodeIds, setResults]);

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
    queuedPendingConcordance,
    setQueuedPendingConcordance,
    handoffConfirmOpen,
    setHandoffConfirmOpen,
    handoffConfirmingRef,
    shouldAutoSearch,
    setShouldAutoSearch,
  } = useConcordancePendingHandoff({
    pendingConcordance,
    clearPendingConcordance,
    hydrationState,
    results,
    selectedNodes,
    setSearchWord,
    setNodeColumnSelections,
    selectNodes,
    handleColorChange,
  });

  // Recompute auto columns if unlocked and selections empty but nodes exist
  useEffect(() => {
    if (!isLocked && selectedNodes.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, selectedNodes, nodeColumnSelections, recomputeAutoColumns]);


  // Color assignment now handled by stack allocator - no auto-fill effect needed




  const handleColumnChange = (nodeId: string, column: string) => setNodeColumnSelection(nodeId, column);

  useEffect(() => {
    if (!shouldAutoSearch) {
      return;
    }
    // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
    const id = requestAnimationFrame(() => {
      setShouldAutoSearch(false);
      void handleSearch(true);
    });
    return () => cancelAnimationFrame(id);
  }, [shouldAutoSearch, handleSearch, setShouldAutoSearch]);

  const handleClearResults = async () => {
    if (!currentWorkspaceId) return;
    await clearResults();
  };

  const handleConfirmPendingConcordance = async () => {
    if (!queuedPendingConcordance) {
      setHandoffConfirmOpen(false);
      return;
    }
    handoffConfirmingRef.current = true;
    try {
      await clearResults({ preserveLocalState: true });
      setHandoffConfirmOpen(false);
    } finally {
      handoffConfirmingRef.current = false;
    }
  };

  const handleCancelPendingConcordance = () => {
    setQueuedPendingConcordance(null);
    setHandoffConfirmOpen(false);
  };

  const handleRunOrUpdate = async () => {
    if (isSnapshotMode(snapshotMode)) return;
    // Commit the per-tab temp colours to the global assigned store so
    // graph + sidebar reflect the colours the user just chose to run
    // with. See the node-colour strategy doc — Run is the promotion
    // trigger.
    promoteTempColors(activeNodeIds);
    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges,
      clearResults: handleClearResults,
      runFreshAnalysis: () =>
        handleSearch(
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          hasLockedParameterChanges,
        ),
    });
  };

  const { combinedLoading, handleViewModeChange } = useConcordanceViewModeSwap({
    viewMode,
    setViewMode,
    results,
    combinedPage,
    globalPageSize,
    updateStoredResult,
    resultsRef,
  });


  const handleRowClick = (
    row: Record<string, unknown>,
    nodeId: string,
    column: string,
    groupedHits?: ConcordanceGroupedRow,
  ) => {
    if (!currentWorkspaceId) return;

    const concordanceHits = groupedHits && groupedHits.length > 0 ? groupedHits : [row];
    const primaryRecord = concordanceHits[0] ?? row;
    const record = { ...primaryRecord };
    const rawFullText = record[column];
    const fullText = rawFullText === null || rawFullText === undefined ? undefined : String(rawFullText);

    setConcordanceDetailExtra({
      concordanceHits,
      caseSensitive: (typeof row.case_sensitive === 'boolean' ? row.case_sensitive : caseSensitive),
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
          value: String(record[CONCORDANCE_COLUMN_KEYS.leftToken] ?? ''),
        },
        ...(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq] != null ? [{
          label: 'L1 Freq',
          value: String(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq]),
        }] : []),
        {
          label: 'R1 Word',
          value: String(record[CONCORDANCE_COLUMN_KEYS.rightToken] ?? ''),
        },
        ...(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq] != null ? [{
          label: 'R1 Freq',
          value: String(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq]),
        }] : []),
      ],
      renderDocumentText: (text: string) =>
        highlightMatchInText(
          text,
          concordanceHits.map((hit) => ({
            start: hit[CONCORDANCE_COLUMN_KEYS.startIdx],
            end: hit[CONCORDANCE_COLUMN_KEYS.endIdx],
          })),
          (typeof matchedTextValue === 'string' && matchedTextValue.length > 0)
            ? matchedTextValue
            : searchWord,
          detailCaseSensitive,
        ),
    };
  })();

  // --- Detach dialog helpers ---
  const openDetachDialog = async (nodes: { nodeId: string; column: string; nodeLabel: string }[]) => {
    setPendingDetachNodes(nodes);

    try {
      const responses = await Promise.all(
        nodes.map((node) => textApi.getConcordanceDetachOptions(node.nodeId, node.column, getAuthHeaders()))
      );
      const options = responses.flatMap((response) => response.data?.nodes ?? []);
      const initial: Record<string, string[]> = {};
      options.forEach((node) => {
        initial[node.node_id] = [];
      });
      setSelectedDetachColumns(initial);
      setDetachDialogNodeOptions(options);
      setDetachDialogOpen(true);
    } catch (error) {
      console.error('Failed to load concordance detach options:', error);
      toast.error(`Failed to load concordance detach options: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setPendingDetachNodes([]);
      setSelectedDetachColumns({});
    }
  };

  const handleDetachConfirm = async () => {
    for (const n of pendingDetachNodes) {
      const cols = selectedDetachColumns[n.nodeId] || [];
      await handleDetach(n.nodeId, n.column, n.nodeLabel, cols, materializedPaths[n.nodeId] ?? null);
    }
    setDetachDialogOpen(false);
    setPendingDetachNodes([]);
    setSelectedDetachColumns({});
    setDetachDialogNodeOptions([]);
  };

  // --- Dispersion detach dialog helpers ---
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
          textApi.getConcordanceDetachOptions(node.nodeId, node.column, getAuthHeaders()),
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
      const dispersionHiddenColumns = new Set<string>([
        CONCORDANCE_COLUMN_KEYS.extraction,
      ]);
      const options = responses.flatMap((response) => response.data?.nodes ?? []).map((node) => {
        const disabled = new Set(node.disabled_columns || []);
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

  const handleDispersionDetachConfirm = async () => {
    const binsSet = pendingDispersionBinSelection
      ? new Set(pendingDispersionBinSelection)
      : null;
    for (const n of pendingDispersionDetachNodes) {
      const cols = selectedDispersionColumns[n.nodeId] || [];
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

  const anyDispersionNodeDetaching = pendingDispersionDetachNodes.some(
    (n) => Boolean(nodeDetaching[n.nodeId]),
  );

  const anyNodeDetaching = pendingDetachNodes.some(n => Boolean(nodeDetaching[n.nodeId]));


  // Snapshot-mode client-side pagination + sort, matching the backend
  // materialised-path semantics:
  //   * When ``sortBy`` is set, flatten the captured groups into hits,
  //     sort the hits by the column, then slice ``pageSize`` hits per
  //     page. Each sliced hit becomes a singleton group so the table
  //     renderer (which flattens groups again to build its rows) sees
  //     the hits in the exact sort order the user expects. This is the
  //     identical control flow the live materialised path runs in
  //     compute_materialized_page → _serialize_materialized_rows.
  //   * When ``sortBy`` is unset, keep the document-grouped shape so
  //     the dispersion view's proportional bars still render one bar
  //     per document. We still paginate at the hit level (matching
  //     ``total_source_rows`` semantics of the live response, which is
  //     "total hits in the parquet"); groups are re-formed by walking
  //     consecutive hits that share the same ``__source_node`` /
  //     document key.
  // Sort comparator falls back to a string compare when values aren't
  // both numeric, mirroring Polars' ``sort`` behaviour closely enough
  // that the user can't tell the difference without a sharp eye.
  const pagedResults = useMemo<ConcordanceAnalysisResponse | null>(() => {
    if (!inSnapshotMode || !results) return results;
    const sliced: Record<string, ConcordanceResultEntry> = {};
    for (const [id, entry] of Object.entries(results.data)) {
      const groups = entry.data ?? [];
      const isCombined = id === '__COMBINED__';
      const np = isCombined ? undefined : nodePagination[id];
      const pageSize = isCombined
        ? globalPageSize
        : (np?.pageSize ?? globalPageSize);
      const currentPage = isCombined
        ? combinedPage
        : (np?.currentPage ?? 1);
      const sortBy = isCombined ? '' : (np?.sortBy ?? '');
      const descending = isCombined ? false : (np?.descending ?? false);

      // Flatten all groups into a flat hits array — pagination is
      // hit-based in the live materialised path so we match that.
      const allHits: Record<string, unknown>[] = [];
      for (const group of groups) {
        for (const hit of group) allHits.push(hit);
      }

      // Optional client-side sort by the user-clicked column. Applied
      // at the hit level so ascending CONC_start_idx yields a strict
      // global ascending sequence, not a per-document ascending
      // sequence (which was the bug in the previous group-level sort).
      let workingHits = allHits;
      if (sortBy && allHits.length > 1) {
        const dir = descending ? -1 : 1;
        workingHits = [...allHits].sort((a, b) => {
          const av = a[sortBy];
          const bv = b[sortBy];
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (typeof av === 'number' && typeof bv === 'number') {
            return dir * (av - bv);
          }
          return dir * String(av).localeCompare(String(bv));
        });
      }

      const totalHits = workingHits.length;
      const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));
      const startIdx = (currentPage - 1) * pageSize;
      const pagedHits = workingHits.slice(startIdx, startIdx + pageSize);

      // Re-form groups for the sliced page. When sortBy is set the
      // hits aren't in document order any more, so we emit each hit as
      // a singleton group — the table view doesn't care (it flattens
      // anyway) and the dispersion view doesn't expose a sortable
      // header so it never sees this branch. When sortBy is empty we
      // re-group consecutive same-document hits to preserve the
      // proportional-bars layout in dispersion view.
      let pagedGroups: Record<string, unknown>[][];
      if (sortBy) {
        pagedGroups = pagedHits.map((h) => [h]);
      } else {
        pagedGroups = [];
        let currentGroup: Record<string, unknown>[] | null = null;
        let currentKey: unknown = Symbol('init');
        // Prefer the captured ConcordanceAnalysisRequest's document
        // column for this node, falling back to ``__source_node``
        // which is always present in materialised rows.
        const docCol = loadedSnapshot?.payload.settings?.node_columns?.[id];
        for (const hit of pagedHits) {
          const key = docCol ? hit[docCol] : hit.__source_node;
          if (currentGroup && key === currentKey) {
            currentGroup.push(hit);
          } else {
            currentGroup = [hit];
            currentKey = key;
            pagedGroups.push(currentGroup);
          }
        }
      }

      sliced[id] = {
        ...entry,
        data: pagedGroups as ConcordanceResultEntry['data'],
        pagination: {
          page: currentPage,
          page_size: pageSize,
          total_source_rows: totalHits,
          total_source_pages: totalPages,
          result_count: pagedHits.length,
          has_next: currentPage < totalPages,
          has_prev: currentPage > 1,
        },
        sorting: { sort_by: sortBy || undefined, descending },
      };
    }
    return { ...results, data: sliced };
  }, [inSnapshotMode, results, loadedSnapshot, nodePagination, globalPageSize, combinedPage]);

  // Snapshot-mode handlePageChange: server doesn't need to be called
  // because all captured rows are already in-memory. We just bump
  // ``nodePagination`` (or combinedPage for the combined view) and let
  // ``pagedResults`` re-slice on the next render.
  const effHandlePageChange = useMemo(() => {
    if (!inSnapshotMode) return handlePageChange;
    return (newPage: number, paginationKey: string, _requestNodeId: string) => {
      if (paginationKey === '__COMBINED__') {
        setCombinedPage(newPage);
        return;
      }
      setNodePagination((prev) => ({
        ...prev,
        [paginationKey]: {
          currentPage: newPage,
          pageSize: prev[paginationKey]?.pageSize ?? globalPageSize,
          sortBy: prev[paginationKey]?.sortBy ?? '',
          descending: prev[paginationKey]?.descending ?? false,
        },
      }));
    };
  }, [inSnapshotMode, handlePageChange, setNodePagination, setCombinedPage, globalPageSize]);

  // Snapshot-mode handleSort: the live ``handleSort`` calls
  // ``resolveTaskId`` → empty ``task_ids`` (no server task exists for
  // a snapshot) → no-op. Instead, we just toggle ``sortBy`` /
  // ``descending`` on the per-node pagination slot and let
  // ``pagedResults`` re-sort the captured groups client-side. Combined
  // view doesn't support sort (its block doesn't render SortableHeader).
  const effHandleSort = useMemo(() => {
    if (!inSnapshotMode) return handleSort;
    return (columnName: string, paginationKey: string, _requestNodeId?: string) => {
      setNodePagination((prev) => {
        const current = prev[paginationKey] ?? {
          currentPage: 1,
          pageSize: globalPageSize,
          sortBy: '',
          descending: false,
        };
        const isSameColumn = current.sortBy === columnName;
        const nextDescending = isSameColumn ? !current.descending : false;
        return {
          ...prev,
          [paginationKey]: {
            ...current,
            currentPage: 1,
            sortBy: columnName,
            descending: nextDescending,
          },
        };
      });
    };
  }, [inSnapshotMode, handleSort, setNodePagination, globalPageSize]);

  // Effective search-param dispatch — when in snapshot mode, the
  // captured request's values drive the read-only ParameterPanel
  // display; otherwise live React state. Computed inline here so
  // the live setters (setSearchWord, etc.) stay correctly bound to
  // live state for when the user exits snapshot view.
  const effSettings = inSnapshotMode ? loadedSnapshot?.payload.settings : undefined;
  const effSearchWord = effSettings?.search_word ?? searchWord;
  const effNumLeftTokens = effSettings?.num_left_tokens ?? numLeftTokens;
  const effNumRightTokens = effSettings?.num_right_tokens ?? numRightTokens;
  const effRegex = effSettings?.regex ?? regex;
  const effWholeWord = effSettings?.whole_word ?? wholeWord;
  const effCaseSensitive = effSettings?.case_sensitive ?? caseSensitive;
  const effSearchMode = effSettings?.search_mode ?? searchMode;
  const effTokensModel = effSettings?.model ?? tokensModel;
  // View-mode dispatch. In snapshot mode the dedicated
  // ``snapshotViewMode`` state drives the Separated/Combined toggle
  // (so Exit returns to the live ``viewMode`` untouched). The
  // Combined tab appears only when ``results.combinable`` is true,
  // which we set above based on whether the captured payload carries
  // the ``__COMBINED__`` entry.
  const effViewMode: 'separated' | 'combined' = inSnapshotMode
    ? snapshotViewMode
    : viewMode;

  // Sync snapshotViewMode with the captured ``settings.combined``
  // flag whenever a new snapshot loads (or when the snapshot's
  // settings reference changes). Keeps the initial render on the
  // mode the snapshot was captured in.
  useEffect(() => {
    if (inSnapshotMode && loadedSnapshot) {
      const cap = loadedSnapshot.payload.settings?.combined ?? false;
      setSnapshotViewMode(cap ? 'combined' : 'separated');
    }
  }, [inSnapshotMode, loadedSnapshot]);

  const effHandleViewModeChange = useMemo(() => {
    if (!inSnapshotMode) return handleViewModeChange;
    return (mode: 'separated' | 'combined') => setSnapshotViewMode(mode);
  }, [inSnapshotMode, handleViewModeChange]);

  return (
    <div className="space-y-4">
      {inSnapshotMode && <ConcordanceSnapshotBanner />}
      <ConcordanceParameterPanel
        panelSelectedNodes={panelSelectedNodes}
        effectiveNodeColumnSelections={effectiveNodeColumnSelections}
        handleColumnChange={handleColumnChange}
        nodeColors={nodeColors}
        handleColorChange={handleColorChange}
        defaultPalette={defaultPalette}
        getColumnInfos={getColumnInfos}
        displayNodeCount={displayNodeCount}
        isLocked={!!isLocked}
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
        tokensModeAvailable={tokensModeAvailable || inSnapshotMode}
        tokensModelOptions={tokensModelOptions}
        tokensModel={effTokensModel}
        setTokensModel={setTokensModel}
        isSearching={isSearching}
        actionState={actionState}
        handleRunOrUpdate={handleRunOrUpdate}
        handleClearResults={handleClearResults}
        globalPageSize={globalPageSize}
        setGlobalPageSize={setGlobalPageSize}
        setNodePagination={setNodePagination}
        persistResultPreferences={persistResultPreferences}
        onSaveSnapshot={handleSaveSnapshot}
        saveSnapshotDisabledReason={saveSnapshotDisabledReason}
        onOpenSnapshot={handleOpenSnapshot}
        snapshotNodeLabels={livePanelSelectedNodes
          .map((n) => (n.name as string | undefined) ?? (n.id as string | undefined) ?? '')
          .filter((s) => s.length > 0)}
        readOnly={inSnapshotMode}
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
          nearestTokenColor={nearestTokenColor}
          setNearestTokenColor={setNearestTokenColor}
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
          selectedNodes={inSnapshotMode ? panelSelectedNodes : selectedNodes}
          panelSelectedNodes={panelSelectedNodes}
          effectiveNodeColumnSelections={effectiveNodeColumnSelections}
          labelToNodeId={labelToNodeId}
          sourceColorMap={sourceColorMap}
          defaultPalette={defaultPalette}
          nodePagination={nodePagination}
          globalPageSize={globalPageSize}
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
          openDetachDialog={openDetachDialog}
          onDispersionDetach={openDispersionDetachDialog}
          readOnly={inSnapshotMode}
        />
      )}

      {results?.state === 'failed' && (
        <Card>
          <CardContent>
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {results?.message ?? 'The search failed. Please try again.'}
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
      <ConfirmDialog
        open={handoffConfirmOpen}
        onOpenChange={(open) => {
          setHandoffConfirmOpen(open);
          if (!open && queuedPendingConcordance && !handoffConfirmingRef.current) {
            handleCancelPendingConcordance();
          }
        }}
        title="Replace concordance results?"
        description="This will clear the current concordance results and fill the clicked token into the search box."
        confirmText="Clear and fill token"
        cancelText="Keep current results"
        onConfirm={() => {
          void handleConfirmPendingConcordance();
        }}
      />
    </div>
  );
};

export default ConcordanceFeature;
