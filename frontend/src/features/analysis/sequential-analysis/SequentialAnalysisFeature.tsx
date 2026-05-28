import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  previewSequentialAnalysis,
  sequentialAnalysisTaskRequest,
  sequentialAnalysisTaskResult,
} from '@/api/generated/sdk.gen';
import type { SequentialAnalysisRequestInput } from '@/api/generated/types.gen';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/stores/uiStore';
import { useSchemaManagement } from '@/hooks/useSchemaManagement';
import { snapshotSourceNodes, useSnapshotBackedAnalysisState } from '@/features/snapshot-view';
import {
  buildCaptureRequest,
  useSequentialAnalysisSnapshotCapture,
} from './hooks/useSequentialAnalysisSnapshotCapture';
import {
  FREQUENCY_ORDER,
  isCoarserOrEqual,
  rebucket,
  type CapturedRow,
} from './sequentialRebucket';
import { TrendsSnapshotConfigDialog } from './components/TrendsSnapshotConfigDialog';
import {
  DEFAULT_TRENDS_SNAPSHOT_CONFIG,
  type SnapshotFinestFrequency,
  type TrendsSnapshotConfig,
} from './trendsSnapshotConfig';
import { useSequentialAnalysisSnapshotLoad } from './hooks/useSequentialAnalysisSnapshotLoad';
import type { SequentialAnalysisSnapshotPayload } from './hooks/useSequentialAnalysisSnapshotLoad';
import { SequentialAnalysisSnapshotBanner } from './components/SequentialAnalysisSnapshotBanner';
import type { WorkspaceNodeLike } from '@/features/analysis/common/nodeSelectionTypes';

import { normalizeSchemaFromInfo } from '@/hooks/useSchemaManagement';
import { fetchNodeInfo } from '@/lib/nodeInfo';
import AnalysisTaskBanner from '@/features/analysis/common/components/AnalysisTaskBanner';
import { normalizeTypeName } from '@/utils/columnTypes';
import { takeMostRecent } from '@/utils/selectionUtils';
import {
  hasLockedParameterDiff,
  normalizeStringArray,
  normalizeUnknownStringArray,
  useAnalysisLock,
  useAnalysisFeature,
  useNodeColorManagement,
  getAnalysisActionState,
  getNodeIdentifier,
  useSafeResult,
  restoreAnalysisLockFromRequest,
  resetAnalysisSelectionAfterClear,
  executeAnalysisRunOrUpdate,
} from '../common';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import {
  useSequentialAnalysisTaskFlow,
  isChartTypeOption,
  getPaletteColor,
  type ChartTypeOption,
} from './hooks/useSequentialAnalysisTaskFlow';
import { useSequentialAnalysisDetach } from './hooks/useSequentialAnalysisDetach';
import { useSequentialResultSummary } from './hooks/useSequentialResultSummary';
import { SequentialAnalysisParameterPanel } from './components/panels/SequentialAnalysisParameterPanel';
import { SequentialAnalysisResultsPanel } from './components/panels/SequentialAnalysisResultsPanel';
import type { SequentialXAxisType } from './components/SequentialChart';
import { ChartImageDownloadDialog } from '@/components/ui/ChartImageDownloadDialog';
import {
  downloadChartAs,
  findSvgInContainer,
  type ChartImageFormat,
  type ChartExportHeaderItem,
  type ChartExportLegendItem,
} from '@/lib/chartExport';

const VALID_CUSTOM_INTERVAL_UNITS: SequentialCustomIntervalUnit[] = [
  'seconds',
  'minutes',
  'hours',
  'days',
  'weeks',
];
type SequentialFrequency = NonNullable<SequentialAnalysisRequestInput['frequency']>;
type SequentialCustomIntervalUnit = NonNullable<
  SequentialAnalysisRequestInput['custom_interval_unit']
>;

// Narrows persisted request values to the custom interval units accepted by the form.
/**
 * Called by: SequentialAnalysisFeature analysis panel during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
 */
const isCustomIntervalUnit = (value: unknown): value is SequentialCustomIntervalUnit =>
  typeof value === 'string' &&
  VALID_CUSTOM_INTERVAL_UNITS.includes(value as SequentialCustomIntervalUnit);

const TIME_COMPATIBLE_TYPES = ['datetime', 'integer', 'float'] as const;
const NUMERIC_TYPE_SET = new Set(['integer', 'float']);

// Parses optional numeric inputs while preserving null for empty or invalid entries.
/**
 * Called by: SequentialAnalysisFeature analysis panel as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
 */
const parseNumericInput = (value: string): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

// Parses custom interval values that must be positive whole numbers.
/**
 * Called by: SequentialAnalysisFeature analysis panel as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
 */
const parsePositiveIntegerInput = (value: string): number | null => {
  const parsed = parseNumericInput(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

// Parses context/minimum-size inputs that may legitimately be zero.
/**
 * Called by: SequentialAnalysisFeature analysis panel as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
 */
const parseNonNegativeIntegerInput = (value: string): number | null => {
  const parsed = parseNumericInput(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

/** Renders the sequential-analysis workflow for live trends and saved snapshot views. */
/**
 * Rendered by: the analysis feature registry when this panel is selected because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 */
const SequentialAnalysisFeature = () => {
  const queryClient = useQueryClient();
  const { selectedNodeId, selectedNode } = useWorkspaceSelection();
  const { nodeData, currentWorkspaceId, currentWorkspace } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'analysis';

  const { getAuthHeaders } = useAuth();
  const {
    isLocked,
    lockWithSnapshots,
    unlockSelection,
    activeNodeId,
    nodeColumnSelections,
    setNodeColumnSelections,
    displayNodeCount,
    serverRequest,
    panelSelectedNodes: livePanelSelectedNodes,
  } = useAnalysisLock({
    analysisType: 'sequential_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    allowedDataTypes: ['datetime'],
    maxNodes: 1,
    docTypeOnly: false,
    storageScope: 'sequential-analysis',
  });

  // Snapshot view state hooks. Hoisted early so the effective-value
  // dispatch below can shadow ``panelSelectedNodes`` / ``results`` /
  // parameter state in one place. The rest of the component reads
  // the shadowed names and naturally picks up snapshot data when in
  // snapshot mode.
  const { loadedSnapshot, inSnapshotMode } =
    useSnapshotBackedAnalysisState<SequentialAnalysisSnapshotPayload>('sequential_analysis');

  const panelSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return livePanelSelectedNodes;
    return snapshotSourceNodes(loadedSnapshot.manifest.source);
  }, [inSnapshotMode, loadedSnapshot, livePanelSelectedNodes]);

  const displayedNodes = takeMostRecent(panelSelectedNodes, 1);
  // Lifted from the panel so promoteTempColors is accessible to the
  // Run handler below. ``tabKey`` routes picker changes through the
  // per-tab temp layer (see node-colour strategy doc).
  const trendsActiveNodeIds = displayedNodes
    .map((node, idx) => getNodeIdentifier(node, idx))
    .filter((id): id is string => Boolean(id));
  const {
    nodeColors: liveTrendsNodeColors,
    handleColorChange: trendsHandleColorChange,
    defaultPalette: trendsDefaultPalette,
    promoteTempColors: trendsPromoteTempColors,
  } = useNodeColorManagement({
    activeNodeIds: trendsActiveNodeIds,
    tabKey: 'analysis',
  });
  // In snapshot mode the live colour store has no entries for the
  // captured node IDs. Shadow with the frozen ``manifest.node_colors``
  // so the swatch + chart series read the captured colour.
  const trendsNodeColors: Record<string, string> =
    inSnapshotMode && loadedSnapshot ? loadedSnapshot.manifest.node_colors : liveTrendsNodeColors;

  const [timeColumn, setTimeColumn] = useState('');
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<SequentialFrequency>('daily');
  const [chartType, setChartType] = useState<ChartTypeOption>('line');
  const [xAxisType, setXAxisType] = useState<SequentialXAxisType>('category');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [numericOriginInput, setNumericOriginInput] = useState<string>('');
  const [numericIntervalInput, setNumericIntervalInput] = useState<string>('1');
  const [customIntervalValueInput, setCustomIntervalValueInput] = useState<string>('1');
  const [customIntervalUnit, setCustomIntervalUnit] =
    useState<SequentialCustomIntervalUnit>('minutes');
  const [minGroupSizeInput, setMinGroupSizeInput] = useState('10');
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [selectedPeriodIndices, setSelectedPeriodIndices] = useState<Set<number>>(new Set());
  const [detachNodeName, setDetachNodeName] = useState('');
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const lastClickedIndexRef = useRef<number | null>(null);

  // Use schema management hook
  const { setLockedSchema, availableColumns, lockCurrentSchema, currentSchemaRef } =
    useSchemaManagement({
      nodeId: activeNodeId,
      isLocked,
      workspaceId: currentWorkspaceId || undefined,
      getAuthHeaders,
      nodeData: nodeData ?? undefined,
      selectedNode: selectedNode ?? undefined,
    });

  const [liveResults, resultRef, setResultSafely, setResults] =
    useSafeResult<Record<string, unknown>>();
  const [hydratingSelection, setHydratingSelection] = useState(false);
  const hydratedParamsRef = useRef<{
    timeColumn: string;
    groupByColumns: string[];
    frequency: SequentialFrequency;
    columnType: 'datetime' | 'numeric';
    numericOrigin: number | null;
    numericInterval: number | null;
    customIntervalValue: number | null;
    customIntervalUnit: SequentialCustomIntervalUnit | null;
    caseSensitive: boolean;
  } | null>(null);

  const {
    resolveTaskId,
    setLocalTaskId,
    isRunning: isAnalyzing,
    isStopping,
    setIsRunning: setIsAnalyzing,
    banner: sequentialWaitingBanner,
    hasActiveTask,
    clearResults,
    stopTask,
  } = useAnalysisFeature<Record<string, unknown>>({
    analysisType: 'sequential_analysis',
    taskType: 'sequential_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef,
    // Loads the latest sequential-analysis result for polling and task resumption.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchResult: async (taskId, headers) => {
      const { data } = await sequentialAnalysisTaskResult({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Retrieves the submitted request so hydration can restore parameters and locks.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchRequest: async (taskId, headers) => {
      const { data } = await sequentialAnalysisTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Applies freshly fetched task results to chart state after lifecycle polling completes.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
    onResultFetched: (resultData) => {
      if (!resultData) return;
      setDetachNodeName('');
      setSelectedPeriodIndices(new Set());
      lastClickedIndexRef.current = null;
      const resolvedChartType = isChartTypeOption(
        (resultData as Record<string, unknown>)?.chart_type,
      )
        ? ((resultData as Record<string, unknown>).chart_type as ChartTypeOption)
        : chartType;
      setResultSafely({
        ...(resultData as Record<string, unknown>),
        analysis_params: {
          ...(((results as Record<string, unknown> | null)?.analysis_params as Record<
            string,
            unknown
          >) ?? {}),
          ...(((resultData as Record<string, unknown>)?.analysis_params as Record<
            string,
            unknown
          >) ?? {}),
        },
        chart_type: resolvedChartType,
      });
      setChartType(resolvedChartType);
    },
    // Rebuilds chart state from a cached result payload and any hydrated request parameters.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
    onHydratedResult: (resultPayload) => {
      if (!resultPayload) return;
      setDetachNodeName('');
      setSelectedPeriodIndices(new Set());
      lastClickedIndexRef.current = null;
      const hydratedParams = hydratedParamsRef.current;
      const enriched = {
        ...(resultPayload as Record<string, unknown>),
        analysis_params: {
          ...(((resultPayload as Record<string, unknown>)?.analysis_params as Record<
            string,
            unknown
          >) ?? {}),
          ...(hydratedParams
            ? {
                group_by_columns: hydratedParams.groupByColumns,
                time_column: hydratedParams.timeColumn,
                frequency: hydratedParams.frequency,
                column_type: hydratedParams.columnType,
                numeric_origin: hydratedParams.numericOrigin,
                numeric_interval: hydratedParams.numericInterval,
                custom_interval_value: hydratedParams.customIntervalValue,
                custom_interval_unit: hydratedParams.customIntervalUnit,
                case_sensitive: hydratedParams.caseSensitive,
              }
            : {}),
        },
      };
      const resolvedChartType = isChartTypeOption(
        (resultPayload as Record<string, unknown>)?.chart_type,
      )
        ? ((resultPayload as Record<string, unknown>).chart_type as ChartTypeOption)
        : chartType;
      setResults({ ...enriched, chart_type: resolvedChartType });
      setChartType(resolvedChartType);
    },
    // Restores sequential request parameters, selection lock, and schema after reload.
    // Called by: useAnalysisFeature hydration because Trends restores must rebuild time-column selection, bucket settings, grouping columns, and case handling from the submitted request. Flow: unwrap request data, apply numeric or datetime controls, restore node/group selections, then release hydration state.
    onHydratedRequest: async (requestPayload) => {
      const req = ((requestPayload as Record<string, unknown>)?.data ?? requestPayload) as Record<
        string,
        unknown
      > | null;
      if (!req) return;
      setHydratingSelection(true);
      const nodeIdStr = String(req.node_id || req.nodeId || '');
      const reqTimeColumn = typeof req.time_column === 'string' ? req.time_column : '';
      const reqColumnType = req.column_type === 'numeric' ? 'numeric' : 'datetime';
      const lockedNumericOrigin =
        reqColumnType === 'numeric' && typeof req.numeric_origin === 'number'
          ? req.numeric_origin
          : null;
      const lockedNumericInterval =
        reqColumnType === 'numeric' && typeof req.numeric_interval === 'number'
          ? req.numeric_interval
          : null;
      if (reqColumnType === 'numeric') {
        setNumericOriginInput(lockedNumericOrigin != null ? String(lockedNumericOrigin) : '');
        setNumericIntervalInput(
          lockedNumericInterval != null ? String(lockedNumericInterval) : '1',
        );
      } else {
        setNumericOriginInput('');
        setNumericIntervalInput('1');
      }
      if (nodeIdStr && reqTimeColumn) {
        setNodeColumnSelections([{ nodeId: nodeIdStr, column: reqTimeColumn }]);
        setTimeColumn(reqTimeColumn);
      }
      const normalizedGroups = Array.isArray(req.group_by_columns)
        ? req.group_by_columns.filter(
            (col: unknown): col is string => typeof col === 'string' && col.trim() !== '',
          )
        : [];
      setGroupByColumns(normalizedGroups.length ? [...normalizedGroups] : []);
      const validFrequencies: SequentialFrequency[] = [
        'hourly',
        'daily',
        'weekly',
        'monthly',
        'quarterly',
        'yearly',
        'custom',
      ];
      const reqFrequency =
        typeof req.frequency === 'string' ? (req.frequency as SequentialFrequency) : undefined;
      const lockedFrequency =
        reqFrequency && validFrequencies.includes(reqFrequency) ? reqFrequency : frequency;
      setFrequency(lockedFrequency);
      const lockedCustomIntervalValue =
        reqColumnType === 'datetime' &&
        lockedFrequency === 'custom' &&
        typeof req.custom_interval_value === 'number' &&
        Number.isInteger(req.custom_interval_value) &&
        req.custom_interval_value > 0
          ? (req.custom_interval_value as number)
          : null;
      const lockedCustomIntervalUnit =
        reqColumnType === 'datetime' &&
        lockedFrequency === 'custom' &&
        isCustomIntervalUnit(req.custom_interval_unit)
          ? (req.custom_interval_unit as SequentialCustomIntervalUnit)
          : null;
      if (lockedFrequency === 'custom' && reqColumnType === 'datetime') {
        setCustomIntervalValueInput(
          lockedCustomIntervalValue != null ? String(lockedCustomIntervalValue) : '1',
        );
        setCustomIntervalUnit(lockedCustomIntervalUnit ?? 'minutes');
      } else {
        setCustomIntervalValueInput('1');
        setCustomIntervalUnit('minutes');
      }
      const reqCaseSensitive = typeof req.case_sensitive === 'boolean' ? req.case_sensitive : true;
      setCaseSensitive(reqCaseSensitive);
      hydratedParamsRef.current = {
        timeColumn: reqTimeColumn,
        groupByColumns: normalizedGroups.length ? [...normalizedGroups] : [],
        frequency: lockedFrequency,
        columnType: reqColumnType,
        numericOrigin: lockedNumericOrigin,
        numericInterval: lockedNumericInterval,
        customIntervalValue: lockedCustomIntervalValue,
        customIntervalUnit: lockedCustomIntervalUnit,
        caseSensitive: reqCaseSensitive,
      };
      if (nodeIdStr && currentWorkspaceId) {
        try {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: { node_ids: [nodeIdStr], node_columns: { [nodeIdStr]: reqTimeColumn } },
            getAuthHeaders,
            lockWithSnapshots,
            queryClient,
            maxNodes: 1,
          });
          const info = await fetchNodeInfo({
            queryClient,
            workspaceId: currentWorkspaceId,
            nodeId: nodeIdStr,
            getAuthHeaders,
          });
          const normalizedSchema = normalizeSchemaFromInfo(info);
          if (Object.keys(normalizedSchema).length > 0) {
            setLockedSchema(normalizedSchema);
          } else {
            setLockedSchema((prev) => prev ?? currentSchemaRef.current);
          }
        } catch {
          setLockedSchema((prev) => prev ?? currentSchemaRef.current);
        }
      }
      setHydratingSelection(false);
    },
    // Clears sequential-specific state after the shared lifecycle removes the task result.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onCleared: (_, options) => {
      setResultSafely(null);
      setHiddenKeys(new Set());
      setDetachNodeName('');
      setSelectedPeriodIndices(new Set());
      lastClickedIndexRef.current = null;
      if (options?.preserveLocalState) {
        return;
      }
      resetAnalysisSelectionAfterClear({ unlockSelection });
      setLockedSchema(null);
      setChartType('line');
      setCaseSensitive(true);
      setNumericOriginInput('');
      setNumericIntervalInput('1');
      setCustomIntervalValueInput('1');
      setCustomIntervalUnit('minutes');
    },
    // Finds task ids embedded in result metadata for status recovery.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    getExtraTaskIdCandidates: () =>
      [
        (resultRef.current as Record<string, unknown> | null)?.metadata as
          | Record<string, unknown>
          | undefined,
      ].map((m) => m?.task_id as string | undefined),
    // Finds task ids embedded in result metadata for clear operations.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    getClearTaskIdSources: () =>
      [
        (resultRef.current as Record<string, unknown> | null)?.metadata as
          | Record<string, unknown>
          | undefined,
      ].map((m) => m?.task_id as string | undefined),
    // Treats hydrated running results as active tasks for the shared banner/action state.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    isResultRunning: (r: Record<string, unknown> | null) => Boolean(r) && r?.state === 'running',
  });

  // Shadow ``results`` so all downstream derivations (chartData,
  // summary, counts) pick up snapshot data without per-call site
  // dispatch. ``setResults`` / ``setResultSafely`` still target the
  // live state — the snapshot store owns its own slice. Plain
  // expression (not useMemo) so the React Compiler can decide
  // memoization without conflicting with manual hints on a
  // refinement-style dispatch.
  const results: Record<string, unknown> | null =
    inSnapshotMode && loadedSnapshot ? loadedSnapshot.payload.result : liveResults;

  // Hydrate the parameter-panel state from the loaded snapshot when
  // entering snapshot mode. Two key differences from the live
  // ``onHydratedRequest`` path:
  //   1. Group-by columns default to ``[]`` (per the snapshot UX:
  //      "start at the smallest frequency with no group option"), even
  //      though the captured rows include all selected columns. The
  //      user picks which to group by in the viewer.
  //   2. Frequency / numeric interval default to the captured
  //      ``finest_frequency`` / ``numeric_interval`` — the chart
  //      starts at the finest captured granularity and the user
  //      coarsens from there.
  /* eslint-disable react-hooks/set-state-in-effect -- One-shot sync
     from the snapshot store; refactoring to render-time would
     duplicate dispatch logic across every render. */
  useEffect(() => {
    if (!inSnapshotMode || !loadedSnapshot) return;
    const settings = loadedSnapshot.payload.settings;
    const result = loadedSnapshot.payload.result;
    const snapshotConfigBlob = (
      settings as { snapshot_config?: Record<string, unknown> } | undefined
    )?.snapshot_config;
    const analysisParams = (result?.analysis_params as Record<string, unknown> | undefined) ?? {};
    const tc = settings?.time_column ?? (analysisParams.time_column as string | undefined) ?? '';
    setTimeColumn(tc);
    // Default to no grouping — user opts in via the panel.
    setGroupByColumns([]);
    const freq: SequentialFrequency =
      (snapshotConfigBlob?.finest_frequency as SequentialFrequency | undefined) ??
      (settings?.frequency as SequentialFrequency | undefined) ??
      (analysisParams.frequency as SequentialFrequency | undefined) ??
      'daily';
    setFrequency(freq);
    const ct = isChartTypeOption(result?.chart_type)
      ? (result.chart_type as ChartTypeOption)
      : 'line';
    setChartType(ct);
    // Captured rows always have case_sensitive=true (the capture pass
    // forces it). The viewer toggle is purely client-side merging;
    // default to ``true`` so the user sees the as-captured legend.
    setCaseSensitive(true);
    const numericOrigin =
      (snapshotConfigBlob?.numeric_origin as number | null | undefined) ??
      settings?.numeric_origin ??
      (analysisParams.numeric_origin as number | null | undefined);
    setNumericOriginInput(
      numericOrigin != null && Number.isFinite(numericOrigin) ? String(numericOrigin) : '',
    );
    const numericInterval =
      (snapshotConfigBlob?.numeric_interval as number | null | undefined) ??
      settings?.numeric_interval ??
      (analysisParams.numeric_interval as number | null | undefined);
    setNumericIntervalInput(
      numericInterval != null && Number.isFinite(numericInterval) ? String(numericInterval) : '1',
    );
    // Snapshot mode never uses ``custom`` frequency; reset to defaults.
    setCustomIntervalValueInput('1');
    setCustomIntervalUnit('minutes');
    setHiddenKeys(new Set());
    setSelectedPeriodIndices(new Set());
    setDetachNodeName('');
  }, [inSnapshotMode, loadedSnapshot]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const timeCompatibleColumns = availableColumns
    .map((column) => ({
      ...column,
      dataType: normalizeTypeName(column.dataType),
    }))
    .filter((column) =>
      TIME_COMPATIBLE_TYPES.includes(column.dataType as (typeof TIME_COMPATIBLE_TYPES)[number]),
    )
    .sort((a, b) => {
      // Prioritizes datetime columns before numeric fallbacks in the default selector.
      /**
       * Called by: SequentialAnalysisFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
       */
      const priority = (type: string) => (type === 'datetime' ? 0 : 1);
      return priority(a.dataType) - priority(b.dataType);
    });

  const timeColumnOptions = timeCompatibleColumns.map((column) => column.name);

  // ``effectiveNodeColumnSelections`` mirrors the snapshot-mode
  // settings so the parameter panel's column dropdown renders the
  // captured time column even when the live workspace doesn't carry
  // it. In live mode it falls through to the actual workspace
  // selections from useAnalysisLock.
  const effectiveNodeColumnSelections = useMemo(() => {
    if (inSnapshotMode && loadedSnapshot) {
      const settings = loadedSnapshot.payload.settings;
      const nodeId = loadedSnapshot.manifest.source.node_ids[0];
      if (nodeId && settings?.time_column) {
        return [{ nodeId, column: settings.time_column }];
      }
      return [];
    }
    return nodeColumnSelections;
  }, [inSnapshotMode, loadedSnapshot, nodeColumnSelections]);

  const activeTimeColumn = (() => {
    if (inSnapshotMode && loadedSnapshot) {
      const settings = loadedSnapshot.payload.settings;
      if (settings?.time_column) return settings.time_column;
      const fromParams = (
        loadedSnapshot.payload.result?.analysis_params as Record<string, unknown> | undefined
      )?.time_column;
      return typeof fromParams === 'string' ? fromParams : '';
    }
    if (!activeNodeId) return '';
    const selection = nodeColumnSelections.find((s) => s.nodeId === activeNodeId);
    if (selection?.column) return selection.column;
    if (timeColumn) return timeColumn;
    const hydratedTime =
      ((results?.analysis_params as Record<string, unknown> | undefined)?.time_column as
        | string
        | undefined) ?? '';
    return hydratedTime;
  })();

  const activeColumnInfo = timeCompatibleColumns.find((column) => column.name === activeTimeColumn);
  const activeColumnType = normalizeTypeName(
    activeColumnInfo?.dataType || (timeCompatibleColumns[0]?.dataType ?? 'datetime'),
  );
  const derivedColumnType: 'datetime' | 'numeric' =
    inSnapshotMode && loadedSnapshot
      ? (loadedSnapshot.payload.settings?.column_type ??
          (loadedSnapshot.payload.result?.analysis_params as Record<string, unknown> | undefined)
            ?.column_type) === 'numeric'
        ? 'numeric'
        : 'datetime'
      : NUMERIC_TYPE_SET.has(activeColumnType)
        ? 'numeric'
        : 'datetime';
  const numericOriginValue =
    derivedColumnType === 'numeric' ? parseNumericInput(numericOriginInput) : null;
  const numericIntervalValue =
    derivedColumnType === 'numeric' ? parseNumericInput(numericIntervalInput) : null;
  const isCustomDatetime = derivedColumnType === 'datetime' && frequency === 'custom';
  const customIntervalValue = isCustomDatetime
    ? parsePositiveIntegerInput(customIntervalValueInput)
    : null;
  const customIntervalUnitValue: SequentialCustomIntervalUnit | null = isCustomDatetime
    ? customIntervalUnit
    : null;

  const hasParamsChanged = hasLockedParameterDiff({
    isLocked,
    serverRequest: serverRequest as Record<string, unknown> | null,
    currentParams: {
      frequency,
      group_by_columns: normalizeStringArray(groupByColumns),
      column_type: derivedColumnType,
      numeric_origin: derivedColumnType === 'numeric' ? numericOriginValue : null,
      numeric_interval: derivedColumnType === 'numeric' ? numericIntervalValue : null,
      custom_interval_value: isCustomDatetime ? customIntervalValue : null,
      custom_interval_unit: isCustomDatetime ? customIntervalUnitValue : null,
      case_sensitive: caseSensitive,
    },
    // Extracts comparable server-side parameters from the stored task request.
    // Called by: SequentialAnalysisFeature lock diffing because request payloads store datetime and numeric bucket settings in nullable backend fields. Flow: normalize frequency, grouping, numeric/custom interval, and case flags, then return comparable sequential params.
    getServerParams: (request) => {
      const serverColumnType =
        typeof request.column_type === 'string' ? request.column_type : 'datetime';
      const serverFrequency = typeof request.frequency === 'string' ? request.frequency : 'year';
      const serverNumericOrigin =
        request.numeric_origin == null ? null : Number(request.numeric_origin);
      const serverNumericInterval =
        request.numeric_interval == null ? null : Number(request.numeric_interval);
      const serverIsCustomDatetime =
        serverColumnType === 'datetime' && serverFrequency === 'custom';
      const serverCustomIntervalValue =
        serverIsCustomDatetime && typeof request.custom_interval_value === 'number'
          ? Number(request.custom_interval_value)
          : null;
      const serverCustomIntervalUnit =
        serverIsCustomDatetime && isCustomIntervalUnit(request.custom_interval_unit)
          ? (request.custom_interval_unit as SequentialCustomIntervalUnit)
          : null;

      const serverCaseSensitive =
        typeof request.case_sensitive === 'boolean' ? request.case_sensitive : true;
      return {
        frequency: serverFrequency,
        group_by_columns: normalizeUnknownStringArray(request.group_by_columns),
        column_type: serverColumnType,
        numeric_origin: serverColumnType === 'numeric' ? serverNumericOrigin : null,
        numeric_interval: serverColumnType === 'numeric' ? serverNumericInterval : null,
        custom_interval_value: serverIsCustomDatetime ? serverCustomIntervalValue : null,
        custom_interval_unit: serverIsCustomDatetime ? serverCustomIntervalUnit : null,
        case_sensitive: serverCaseSensitive,
      };
    },
  });

  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: Boolean(activeNodeId),
    isLocked,
    hasResults: Boolean(results),
    isBusy: isAnalyzing,
    hasActiveTask,
    allowRunWhenLocked: hasParamsChanged,
    canUpdate: true,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- Complex sync logic with guards to prevent infinite loops; refactoring to render-time would duplicate guard logic */
  useEffect(() => {
    if (inSnapshotMode) return;
    if (isLocked || hydratingSelection) return;
    if (!selectedNodeId) {
      if (nodeColumnSelections.length > 0) {
        setNodeColumnSelections([], { replace: true });
      }
      if (timeColumn !== '') {
        setTimeColumn('');
      }
      return;
    }

    if (!timeColumnOptions.length) {
      // Check current state before updating to avoid infinite loop
      const currentSelection = nodeColumnSelections.find((s) => s.nodeId === selectedNodeId);
      if (!currentSelection || currentSelection.column !== '') {
        setNodeColumnSelections([{ nodeId: selectedNodeId, column: '' }]);
      }
      if (timeColumn !== '') {
        setTimeColumn('');
      }
      return;
    }

    const desired = timeColumnOptions.includes(timeColumn) ? timeColumn : timeColumnOptions[0]!;
    if (desired !== timeColumn) {
      setTimeColumn(desired);
    }

    // Check current state before updating to avoid infinite loop
    const currentSelection = nodeColumnSelections.find((s) => s.nodeId === selectedNodeId);
    if (!currentSelection || currentSelection.column !== desired) {
      setNodeColumnSelections([{ nodeId: selectedNodeId, column: desired }]);
    }
  }, [
    inSnapshotMode,
    isLocked,
    hydratingSelection,
    selectedNodeId,
    timeColumnOptions,
    setNodeColumnSelections,
    nodeColumnSelections,
    timeColumn,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Adds a blank grouping control up to the supported three-column limit.
  /**
   * Called by: SequentialAnalysisFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleAddGroupByColumn = () => {
    if (groupByColumns.length < 3) {
      setGroupByColumns([...groupByColumns, '']);
    }
  };

  // Removes one grouping control while preserving the order of the remaining groups.
  /**
   * Called by: SequentialAnalysisFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleRemoveGroupByColumn = (index: number) => {
    setGroupByColumns(groupByColumns.filter((_, i) => i !== index));
  };

  // Updates the selected column for one grouping slot.
  /**
   * Called by: SequentialAnalysisFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleGroupByColumnChange = (index: number, value: string) => {
    const newColumns = [...groupByColumns];
    newColumns[index] = value;
    setGroupByColumns(newColumns);
  };

  // Toggles chart series visibility without losing the underlying result rows.
  /**
   * Called by: SequentialAnalysisFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleToggleKey = (key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const {
    // Toggles or range-selects chart periods for the add-to-workspace detach flow.
    handleAnalyze,
    handleClearResults,
    handleChartTypeChange,
    chartData: liveChartData,
    groupKeys: liveGroupKeys,
    chartConfig: liveChartConfig,
    groupPointCounts: liveGroupPointCounts,
  } = useSequentialAnalysisTaskFlow({
    state: {
      currentWorkspaceId,
      activeNodeId,
      nodeColumnSelections,
      timeColumn,
      groupByColumns,
      frequency,
      chartType,
      derivedColumnType,
      numericOriginValue,
      numericIntervalValue,
      numericOriginInput,
      customIntervalValue,
      customIntervalUnit: customIntervalUnitValue,
      caseSensitive,
      results,
    },
    actions: {
      setIsAnalyzing,
      setResults,
      setChartType,
      setLocalTaskId,
      setNodeColumnSelections,
      setTimeColumn,
      lockWithSnapshots,
      lockCurrentSchema,
      resolveTaskId,
      clearResults,
    },
    lock: { getAuthHeaders, queryClient },
  });

  // ── Snapshot-mode re-aggregation ─────────────────────────────────────
  //
  // In snapshot mode, the chart data comes from running the captured
  // rows through ``rebucket`` with the user's view-time config (any
  // post-fit frequency coarsening, group-dim drop, case-fold). In live
  // mode we use the task-flow's output directly. The chart, summary
  // counts, and detach surface all read these shadowed values without
  // caring which path produced them.
  const capturedRows: CapturedRow[] = (() => {
    if (!inSnapshotMode || !loadedSnapshot) return [];
    const data = (loadedSnapshot.payload.result as Record<string, unknown> | undefined)?.data;
    return Array.isArray(data) ? (data as CapturedRow[]) : [];
  })();
  const capturedSnapshotConfig = (
    loadedSnapshot?.payload.settings as { snapshot_config?: Record<string, unknown> } | undefined
  )?.snapshot_config;
  const captureFinestFrequency =
    (capturedSnapshotConfig?.finest_frequency as SnapshotFinestFrequency | undefined) ??
    (loadedSnapshot?.payload.settings?.frequency === 'custom'
      ? 'daily'
      : (loadedSnapshot?.payload.settings?.frequency as SnapshotFinestFrequency | undefined)) ??
    'daily';
  const captureNumericOrigin = (() => {
    const fromConfig = capturedSnapshotConfig?.numeric_origin;
    if (typeof fromConfig === 'number') return fromConfig;
    const fromSettings = loadedSnapshot?.payload.settings?.numeric_origin;
    return typeof fromSettings === 'number' ? fromSettings : null;
  })();
  const snapshotRebucket =
    inSnapshotMode && loadedSnapshot
      ? rebucket(capturedRows, {
          columnType: derivedColumnType,
          viewFrequency:
            frequency === 'custom'
              ? captureFinestFrequency
              : (frequency as SnapshotFinestFrequency),
          viewNumericInterval: numericIntervalValue ?? 1,
          captureNumericOrigin,
          viewGroupByColumns: groupByColumns.filter((c) => c.trim() !== ''),
          caseSensitive,
        })
      : null;

  const chartData = snapshotRebucket?.chartData ?? liveChartData;
  const groupKeys = snapshotRebucket?.groupKeys ?? liveGroupKeys;
  const chartConfig = snapshotRebucket?.chartConfig ?? liveChartConfig;
  const groupPointCounts = snapshotRebucket?.groupPointCounts ?? liveGroupPointCounts;

  // Snapshot-mode parameter-panel options:
  //   - Frequency dropdown: coarser-or-equal to the captured finest
  //     frequency (no 'custom', no refinement).
  //   - Group-by column list: the columns the capture actually
  //     shipped (a subset of the live workspace's columns).
  // In live mode the panel uses its default options.
  const snapshotFrequencyOptions = inSnapshotMode
    ? FREQUENCY_ORDER.filter((freq) => isCoarserOrEqual(freq, captureFinestFrequency)).map(
        (value) => ({
          value: value as SequentialFrequency,
          label: value.charAt(0).toUpperCase() + value.slice(1),
        }),
      )
    : undefined;
  const snapshotAvailableColumns = (() => {
    if (!inSnapshotMode) return null;
    const capturedGroupColumns: string[] = Array.isArray(capturedSnapshotConfig?.group_by_columns)
      ? (capturedSnapshotConfig!.group_by_columns as string[])
      : Array.isArray(loadedSnapshot?.payload.settings?.group_by_columns)
        ? (loadedSnapshot!.payload.settings!.group_by_columns as string[])
        : [];
    // Map back to the ColumnLike shape the panel expects.
    return capturedGroupColumns.map((name) => ({ name, dataType: 'string' }));
  })();

  // Toggles or range-selects chart periods for the add-to-workspace detach flow.
  /**
   * Called by: SequentialAnalysisFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   * Flow: ignore out-of-range clicks, add shift-click ranges from the last anchor or toggle a single period, then store the updated selection set.
   */
  const handlePeriodClick = (index: number, shiftHeld: boolean) => {
    if (index < 0 || index >= chartData.length) return;

    setSelectedPeriodIndices((prev) => {
      const next = new Set(prev);

      if (shiftHeld && lastClickedIndexRef.current !== null) {
        const lower = Math.min(lastClickedIndexRef.current, index);
        const upper = Math.max(lastClickedIndexRef.current, index);
        for (let cursor = lower; cursor <= upper; cursor += 1) {
          next.add(cursor);
        }
      } else {
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        lastClickedIndexRef.current = index;
      }

      return next;
    });
  };

  // Clears selected chart periods and the anchor used for shift-click range selection.
  /**
   * Called by: SequentialAnalysisFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   */
  const clearPeriodSelection = () => {
    setSelectedPeriodIndices(new Set());
    lastClickedIndexRef.current = null;
  };

  // Runs a fresh trends analysis or updates a locked task after parameter changes.
  /**
   * Called by: SequentialAnalysisFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleRunOrUpdate = async () => {
    if (inSnapshotMode) return;
    // Promote pending per-tab temp colours to assigned (Run is the
    // commit trigger per the node-colour strategy doc).
    trendsPromoteTempColors(trendsActiveNodeIds);
    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges: hasParamsChanged,
      clearResults,
      runFreshAnalysis: handleAnalyze,
      clearOptionsOnUpdate: { preserveLocalState: true },
    });
  };

  // ----- Snapshot capture + load wiring -----
  const handleOpenSnapshot = useSequentialAnalysisSnapshotLoad();

  const liveCaptureNode: WorkspaceNodeLike | null = livePanelSelectedNodes[0] ?? null;
  const getSequentialNodeRowCount = useCallback((node: WorkspaceNodeLike): number => {
    const shape = node.shape as unknown;
    if (Array.isArray(shape) && typeof shape[0] === 'number') return shape[0];
    return 0;
  }, []);

  // Snapshot capture config — picked by the user in
  // <TrendsSnapshotConfigDialog> before saving. Seeded with sensible
  // defaults so a quick Save → Save flow produces a reasonable
  // bundle without forcing the user through every option.
  const [snapshotConfig, setSnapshotConfig] = useState<TrendsSnapshotConfig>(() => ({
    ...DEFAULT_TRENDS_SNAPSHOT_CONFIG,
    // Seed group columns from the live form's selected groups so the
    // user doesn't have to re-tick them after experimenting in live.
    groupByColumns: groupByColumns.filter((c) => c.trim() !== '').slice(0, 3),
  }));

  // When the active live frequency changes, refresh the dialog's
  // default to match (but only if the user hasn't customised it).
  // ``inSnapshotMode`` skips the auto-sync — snapshot mode shouldn't
  // touch this state.
  const liveSnapshotFrequencyDefault = useMemo<SnapshotFinestFrequency>(() => {
    if (frequency === 'custom') return 'daily';
    if (frequency === 'second' || frequency === 'minute') return frequency;
    return frequency as SnapshotFinestFrequency;
  }, [frequency]);
  /* eslint-disable react-hooks/set-state-in-effect -- Track live form
     changes into the snapshot dialog's default. Sync-only, no risk of
     infinite loops because deps are exact. */
  useEffect(() => {
    if (inSnapshotMode) return;
    setSnapshotConfig((prev) =>
      prev.finestFrequency === liveSnapshotFrequencyDefault
        ? prev
        : { ...prev, finestFrequency: liveSnapshotFrequencyDefault },
    );
  }, [inSnapshotMode, liveSnapshotFrequencyDefault]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const captureWithConfig = useSequentialAnalysisSnapshotCapture({
    workspaceId: currentWorkspaceId ?? null,
    workspaceName: currentWorkspace?.name ?? currentWorkspaceId ?? '(workspace)',
    timeColumn: activeTimeColumn,
    columnType: derivedColumnType,
    selectedNode: liveCaptureNode,
    getNodeRowCount: getSequentialNodeRowCount,
    getAuthHeaders,
  });

  // Wrapped onSave used by <SnapshotActions> — reads the current
  // ``snapshotConfig`` state at call time so the dialog's final
  // values flow through to the capture hook.
  const handleSaveSnapshot = useCallback(
    async (filename: string, description: string) => {
      await captureWithConfig(filename, description, snapshotConfig);
    },
    [captureWithConfig, snapshotConfig],
  );

  // Available metadata columns the user can group by — derived
  // inline (React Compiler handles memoisation automatically). Grouping
  // only makes sense for low-cardinality categorical/text columns; the
  // capture pass would otherwise blow past the row cap when a user
  // ticks a float / datetime / list column.
  const availableGroupByColumns: string[] = availableColumns
    .filter((c) => {
      if (!c.name || c.name === activeTimeColumn) return false;
      const dt = normalizeTypeName(c.dataType);
      return dt === 'string' || dt === 'categorical';
    })
    .map((c) => c.name);

  // Years-span hint for the dialog's estimator. Inferred from the
  // live result's earliest / latest time_period. ``null`` when fewer
  // than two periods are available; the dialog assumes one year.
  const liveYearsSpanHint: number | null = (() => {
    const live = liveResults as Record<string, unknown> | null;
    const liveData = Array.isArray(live?.data)
      ? (live!.data as Array<Record<string, unknown>>)
      : [];
    if (liveData.length < 2) return null;
    const periods = liveData
      .map((r) => r.period_start ?? r.time_period)
      .filter((v): v is string | number => v != null);
    if (periods.length < 2) return null;
    const first = new Date(String(periods[0])).getTime();
    const last = new Date(String(periods[periods.length - 1])).getTime();
    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
    return Math.max(0.01, (last - first) / (365 * 86400 * 1000));
  })();

  const liveCaptureNodeId = liveCaptureNode
    ? ((liveCaptureNode.id as string | undefined) ??
      (liveCaptureNode.node_id as string | undefined) ??
      '')
    : '';
  const liveCaptureNodeRowCount = liveCaptureNode ? getSequentialNodeRowCount(liveCaptureNode) : 0;

  // Optional backend dry-run: hits the preview endpoint which runs
  // the same aggregation but doesn't touch the live task store —
  // calling the regular ``sequentialAnalysis`` endpoint would conflict
  // with the user's existing live result (the backend rejects
  // differing requests under the same task slot with a 409
  // "Clear current sequential analysis results..."). The preview
  // endpoint returns just ``total_records``, no chart data shipped.
  /**
   * Called by: SequentialAnalysisFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
   */
  const dryRunSnapshotRows = async (config: TrendsSnapshotConfig): Promise<number> => {
    if (!liveCaptureNode || !activeTimeColumn) return 0;
    const nodeId =
      (liveCaptureNode.id as string | undefined) ??
      (liveCaptureNode.node_id as string | undefined) ??
      '';
    if (!nodeId) return 0;
    const req = buildCaptureRequest(activeTimeColumn, derivedColumnType, config);
    const { data: result } = await previewSequentialAnalysis({
      body: req,
      headers: getAuthHeaders(),
      path: { node_id: nodeId },
      query: { include_data: false },
      throwOnError: true,
    });
    return typeof result?.total_records === 'number' ? result.total_records : 0;
  };

  const saveSnapshotDisabledReason = (() => {
    if (inSnapshotMode) {
      return 'Exit snapshot view first to capture a new snapshot from live results.';
    }
    if (!liveCaptureNode) {
      return 'Select a data block first.';
    }
    const rowCount = getSequentialNodeRowCount(liveCaptureNode);
    if (rowCount > 2_000) {
      return `Demo snapshots cap each selected data block at 2,000 rows; selected block has ${rowCount.toLocaleString()}.`;
    }
    if (!liveResults) {
      return 'Run the trends analysis (and let it finish) before saving a snapshot.';
    }
    return undefined;
  })();

  // Snapshot-aware chart-type change. The live handler also persists
  // to the backend via ``postSequentialAnalysisTaskResult``; in
  // snapshot mode we keep the change client-side only — the displayed
  // chart updates, the captured bundle stays immutable.
  const effHandleChartTypeChange = inSnapshotMode
    ? (value: ChartTypeOption) => {
        setChartType(value);
      }
    : handleChartTypeChange;

  const {
    timeColumn: summaryTimeColumn,
    groupBy: summaryGroupBy,
    columnType: summaryColumnType,
    numericOrigin: summaryNumericOrigin,
    numericInterval: summaryNumericInterval,
    frequencyDisplay: summaryFrequency,
  } = useSequentialResultSummary(results, {
    timeColumn,
    groupBy: groupByColumns,
    columnType: derivedColumnType,
    numericOrigin: numericOriginValue ?? null,
    numericInterval: numericIntervalValue ?? null,
    frequency,
    customIntervalValue,
    customIntervalUnit: customIntervalUnitValue,
  });
  const minGroupSize = parseNonNegativeIntegerInput(minGroupSizeInput) ?? 0;

  const rawResultRows = Array.isArray(results?.data)
    ? (results.data as Array<Record<string, unknown>>)
    : [];

  // In snapshot mode the displayed grouping is the viewer's view-time
  // choice (a subset of the captured columns), not the captured
  // analysis_params group. Filtering must key off the viewer's columns
  // so the keys generated here match the rebucketed ``groupKeys`` —
  // otherwise every chart key looks up as 0 and the min-group-size
  // filter rejects everything. Case-folding mirrors rebucket: captured
  // rows are always case-sensitive, the viewer's toggle merges client-
  // side.
  const effectiveGroupBy = inSnapshotMode
    ? groupByColumns.filter((c) => c.trim() !== '')
    : summaryGroupBy;
  // Normalizes group values the same way snapshot rebucketing does for visibility checks.
  /**
   * Called by: SequentialAnalysisFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   */
  const foldGroupValue = (raw: unknown): string => {
    const str = raw == null ? '' : String(raw);
    return inSnapshotMode && !caseSensitive ? str.toLowerCase() : str;
  };

  // Builds the visible-series key for one raw result row.
  /**
   * Called by: SequentialAnalysisFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const getGroupKey = (row: Record<string, unknown>) =>
    effectiveGroupBy.map((column) => foldGroupValue(row[column])).join(' - ');

  const groupSizeByKey = (() => {
    if (!effectiveGroupBy.length) return {} as Record<string, number>;

    const sizes: Record<string, number> = {};
    rawResultRows.forEach((row) => {
      const groupKey = getGroupKey(row);
      const count = row.sequential_count;
      const numericCount = typeof count === 'number' ? count : Number(count ?? 0);
      sizes[groupKey] = (sizes[groupKey] ?? 0) + numericCount;
    });
    return sizes;
  })();

  // Applies the minimum group-size threshold to chart series keys.
  /**
   * Called by: SequentialAnalysisFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   */
  const passesMinGroupSize = (key: string) =>
    !effectiveGroupBy.length || (groupSizeByKey[key] ?? 0) >= minGroupSize;
  const filteredGroupKeys = groupKeys.filter((key) => passesMinGroupSize(key));
  const filteredOutGroupKeys = new Set(groupKeys.filter((key) => !passesMinGroupSize(key)));
  const invisibleGroupKeys = new Set([...hiddenKeys, ...filteredOutGroupKeys]);

  const canDetach =
    selectedPeriodIndices.size > 0 &&
    selectedPeriodIndices.size < chartData.length &&
    filteredGroupKeys.length > 0;

  const { handleDetach, isDetaching, defaultNodeName } = useSequentialAnalysisDetach({
    currentWorkspaceId,
    resolveTaskId,
    getAuthHeaders,
    panelSelectedNodes,
    chartData,
    results,
    excludedGroupKeys: invisibleGroupKeys,
    selectedPeriodIndices,
    requestedNodeName: detachNodeName,
    queryClient,
  });

  // Checks whether one raw row belongs to a currently visible chart series.
  /**
   * Called by: SequentialAnalysisFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   */
  const isRowVisible = (row: Record<string, unknown>) => {
    if (!effectiveGroupBy.length) return true;
    return !invisibleGroupKeys.has(getGroupKey(row));
  };

  // Produces the bucket id used to match selected chart points back to raw rows.
  /**
   * Called by: SequentialAnalysisFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const getTimeBucketKey = (row: Record<string, unknown>) =>
    String(
      (row.time_period_formatted as string | number | undefined) ??
        (row.time_period as string | number | undefined) ??
        '',
    );

  const selectedTimeBucketKeys = new Set(
    Array.from(selectedPeriodIndices)
      .map((index) => String(chartData[index]?.time_period ?? ''))
      .filter((value) => value.length > 0),
  );

  // Sums sequential document counts across raw rows for summary metrics.
  /**
   * Called by: SequentialAnalysisFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   */
  const sumSequentialDocs = (rows: Array<Record<string, unknown>>) =>
    rows.reduce((total, row) => {
      const count = row.sequential_count;
      return total + (typeof count === 'number' ? count : Number(count ?? 0));
    }, 0);

  const shownRows = rawResultRows.filter(isRowVisible);
  const chosenRows = shownRows.filter((row) => selectedTimeBucketKeys.has(getTimeBucketKey(row)));

  const totalPointCount =
    typeof results?.total_records === 'number' ? results.total_records : rawResultRows.length;
  const totalDocumentCount =
    typeof panelSelectedNodes[0]?.shape?.[0] === 'number'
      ? panelSelectedNodes[0].shape[0]
      : sumSequentialDocs(rawResultRows);
  const shownPointCount = shownRows.length;
  const shownDocumentCount = sumSequentialDocs(shownRows);
  const chosenPointCount = selectedPeriodIndices.size > 0 ? chosenRows.length : 0;
  const chosenDocumentCount = selectedPeriodIndices.size > 0 ? sumSequentialDocs(chosenRows) : 0;

  const resultsSummary = summaryTimeColumn
    ? summaryColumnType === 'numeric'
      ? `Numeric bin counts for ${summaryTimeColumn}`
      : `Frequency of records grouped by ${summaryTimeColumn}`
    : 'Aggregated frequency over time';

  // Exports the rendered chart SVG with contextual title and legend metadata.
  /**
   * Called by: SequentialAnalysisFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
   */
  const handleDownloadChart = async (format: ChartImageFormat) => {
    if (!chartContainerRef.current) {
      toast.error('Chart not available for export.');
      return;
    }
    const svg = findSvgInContainer(chartContainerRef.current);
    if (!svg) {
      toast.error('Chart SVG not found.');
      return;
    }
    const nodeName = panelSelectedNodes[0]?.name ?? panelSelectedNodes[0]?.id ?? 'data';
    const header: ChartExportHeaderItem[] = [
      { label: 'Data Block', value: nodeName },
      { label: 'Time Column', value: summaryTimeColumn || '—' },
      { label: 'Frequency', value: summaryFrequency ?? '—' },
      { label: 'Total', value: `${totalPointCount}/${totalDocumentCount}` },
      { label: 'Shown', value: `${shownPointCount}/${shownDocumentCount}` },
      { label: 'Chosen', value: `${chosenPointCount}/${chosenDocumentCount}` },
      { label: 'Groups', value: summaryGroupBy.length ? summaryGroupBy.join(', ') : 'None' },
    ];
    const legend: ChartExportLegendItem[] = filteredGroupKeys.map((key, idx) => ({
      label: (chartConfig[key]?.label as string | undefined) ?? key,
      color: chartConfig[key]?.color ?? getPaletteColor(idx) ?? '#888888',
      type: chartType === 'line' ? 'line' : chartType === 'bar' ? 'bar' : 'area',
      hidden: hiddenKeys.has(key),
    }));
    try {
      await downloadChartAs(svg, {
        nodeName,
        toolSuffix: 'trends',
        format,
        header,
        legend,
      });
    } catch (err) {
      toast.error('Failed to export chart.');
      console.error(err);
    }
  };

  return (
    <div className="space-y-4">
      {inSnapshotMode && <SequentialAnalysisSnapshotBanner />}
      <AnalysisCardLayout
        title="Trends and Sequence"
        info={{
          targetKey: 'sequential-analysis.overview',
          label: 'About Sequential Analysis',
          tooltip: 'Learn what sequential analysis is and how it can help you.',
        }}
        help={{
          targetKey: 'analysis.sequential-analysis.parameters',
          label: 'Sequential analysis parameters',
          tooltip: 'Select a time column, choose frequency, and configure group-by options.',
        }}
        snapshot={{
          tool: 'sequential_analysis',
          onSave: handleSaveSnapshot,
          saveDisabledReason: saveSnapshotDisabledReason,
          onOpen: handleOpenSnapshot,
          nodeLabels: livePanelSelectedNodes
            .map((n) => (n.name as string | undefined) ?? (n.id as string | undefined) ?? '')
            .filter((s) => s.length > 0),
          // Trends overrides the standard Save dialog with a richer
          // configuration dialog: pick the finest time bin + group-by
          // columns so the viewer can re-aggregate client-side.
          // Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
          // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
          saveDialog: ({ open, onOpenChange, tool, existingFilenames, defaultName, onSave }) => (
            <TrendsSnapshotConfigDialog
              open={open}
              onOpenChange={onOpenChange}
              tool={tool}
              existingFilenames={existingFilenames}
              defaultName={defaultName}
              onSave={onSave}
              config={snapshotConfig}
              onConfigChange={setSnapshotConfig}
              columnType={derivedColumnType}
              availableGroupByColumns={availableGroupByColumns}
              workspaceId={currentWorkspaceId}
              nodeId={liveCaptureNodeId}
              nodeRowCount={liveCaptureNodeRowCount}
              yearsSpanHint={liveYearsSpanHint}
              dryRunRowCount={dryRunSnapshotRows}
            />
          ),
        }}
        actions={{
          // Routes the Run button through live sequential analysis only outside snapshot mode.
          // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
          onRun: () => {
            if (inSnapshotMode) return;
            void handleRunOrUpdate();
          },
          // Stops the active sequential-analysis task from the shared layout action.
          // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
          onStop: () => {
            if (inSnapshotMode) return;
            void stopTask();
          },
          // Clears live sequential-analysis results from the shared layout action.
          // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
          onClear: () => {
            if (inSnapshotMode) return;
            void handleClearResults();
          },
          runDisabled:
            inSnapshotMode || actionState.runDisabled || isLoading.operations || !activeTimeColumn,
          runDisabledReason: (() => {
            if (inSnapshotMode) return 'Disabled in snapshot view';
            if (isAnalyzing || isLoading.operations) return undefined;
            if (actionState.runDisabledReason) return actionState.runDisabledReason;
            if (!activeTimeColumn) return 'Select a time column to run';
            return undefined;
          })(),
          clearDisabled: inSnapshotMode || actionState.clearDisabled,
          isRunning: isAnalyzing,
          isStopping,
          hasResult: Boolean(results),
          runLabel: actionState.runLabel,
          clearHelp: {
            targetKey: 'analysis.sequential-analysis.clear-results',
            label: 'Clear results',
          },
        }}
      >
        <SequentialAnalysisParameterPanel
          selectedNodes={displayedNodes}
          nodeColumnSelections={effectiveNodeColumnSelections}
          timeCompatibleColumns={timeCompatibleColumns}
          timeCompatibleTypes={Array.from(TIME_COMPATIBLE_TYPES)}
          isLocked={Boolean(isLocked) || inSnapshotMode}
          lockedMessage={
            inSnapshotMode ? 'Viewing a saved snapshot — selection is frozen.' : undefined
          }
          displayNodeCount={displayNodeCount}
          onColumnChange={(nodeId, column) => {
            if (isLocked || inSnapshotMode) return;
            setNodeColumnSelections([{ nodeId, column }]);
            setTimeColumn(column);
          }}
          derivedColumnType={derivedColumnType}
          // Snapshot mode unlocks all the post-fit-tunable inputs
          // (frequency, group-by, case-sensitive, numeric interval).
          // The captured x-axis column stays locked via ``isLocked``;
          // the parameter inputs drive client-side ``rebucket``.
          inputsDisabled={
            !inSnapshotMode && !isLocked && (isAnalyzing || isLoading.operations || !activeNodeId)
          }
          frequencyOptions={snapshotFrequencyOptions}
          activeNodeId={activeNodeId}
          selectedNodeId={selectedNodeId}
          currentWorkspaceId={currentWorkspaceId}
          frequency={frequency}
          onFrequencyChange={setFrequency}
          customIntervalValueInput={customIntervalValueInput}
          onCustomIntervalValueChange={setCustomIntervalValueInput}
          customIntervalUnit={customIntervalUnit}
          onCustomIntervalUnitChange={setCustomIntervalUnit}
          numericOriginInput={numericOriginInput}
          onNumericOriginChange={setNumericOriginInput}
          numericIntervalInput={numericIntervalInput}
          onNumericIntervalChange={setNumericIntervalInput}
          availableColumns={snapshotAvailableColumns ?? availableColumns}
          groupByColumns={groupByColumns}
          onAddGroupByColumn={handleAddGroupByColumn}
          onRemoveGroupByColumn={handleRemoveGroupByColumn}
          onGroupByColumnChange={handleGroupByColumnChange}
          caseSensitive={caseSensitive}
          onCaseSensitiveChange={setCaseSensitive}
          nodeColors={trendsNodeColors}
          defaultPalette={trendsDefaultPalette}
          onColorChange={trendsHandleColorChange}
        />
      </AnalysisCardLayout>

      {sequentialWaitingBanner && (
        <AnalysisTaskBanner
          analysisName="Trends and Sequence"
          status={sequentialWaitingBanner.status}
          taskId={sequentialWaitingBanner.taskId}
          message={sequentialWaitingBanner.message}
          className="mt-4"
        />
      )}

      {results && (
        <SequentialAnalysisResultsPanel
          resultsSummary={resultsSummary}
          summary={{
            timeColumn: summaryTimeColumn,
            groupBy: summaryGroupBy,
            columnType: summaryColumnType,
            numericOrigin: summaryNumericOrigin,
            numericInterval: summaryNumericInterval,
            frequencyDisplay: summaryFrequency,
          }}
          counts={{
            total: totalPointCount,
            totalDocuments: totalDocumentCount,
            shown: shownPointCount,
            shownDocuments: shownDocumentCount,
            chosen: chosenPointCount,
            chosenDocuments: chosenDocumentCount,
          }}
          minGroupSizeInput={minGroupSizeInput}
          onMinGroupSizeChange={setMinGroupSizeInput}
          chartType={chartType}
          onChartTypeChange={effHandleChartTypeChange}
          xAxisType={xAxisType}
          onXAxisTypeChange={setXAxisType}
          onDownloadClick={() => setDownloadDialogOpen(true)}
          chartData={chartData}
          chartConfig={chartConfig}
          groupKeys={filteredGroupKeys}
          groupPointCounts={groupPointCounts}
          hiddenKeys={hiddenKeys}
          selectedPeriodIndices={selectedPeriodIndices}
          canDetach={canDetach}
          isDetaching={isDetaching}
          onToggleKey={handleToggleKey}
          onPeriodClick={handlePeriodClick}
          onClearSelection={clearPeriodSelection}
          detachNodeName={detachNodeName}
          detachNodeNamePlaceholder={defaultNodeName}
          onDetachNodeNameChange={setDetachNodeName}
          onDetach={() => {
            if (inSnapshotMode) return;
            void handleDetach();
          }}
          containerRef={chartContainerRef}
          readOnly={inSnapshotMode}
        />
      )}
      <ChartImageDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        title="Download Trends Chart"
        onConfirm={(format) => {
          void handleDownloadChart(format);
        }}
      />
    </div>
  );
};

export default SequentialAnalysisFeature;
