import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/stores/uiStore';
import { useSchemaManagement } from '@/hooks/useSchemaManagement';
import {
  type SequentialAnalysisRequest,
  type SequentialCustomIntervalUnit,
  type SequentialFrequency,
  textApi,
} from '@/api/text';
import {
  isSnapshotMode,
  useSnapshotViewStore,
  useToolSnapshotMode,
  type LoadedSnapshot,
} from '@/features/snapshot-view';
import { useSequentialAnalysisSnapshotCapture } from './hooks/useSequentialAnalysisSnapshotCapture';
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

const isCustomIntervalUnit = (value: unknown): value is SequentialCustomIntervalUnit =>
  typeof value === 'string' &&
  VALID_CUSTOM_INTERVAL_UNITS.includes(value as SequentialCustomIntervalUnit);

const TIME_COMPATIBLE_TYPES = ['datetime', 'integer', 'float'] as const;
const NUMERIC_TYPE_SET = new Set(['integer', 'float']);

const parseNumericInput = (value: string): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePositiveIntegerInput = (value: string): number | null => {
  const parsed = parseNumericInput(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseNonNegativeIntegerInput = (value: string): number | null => {
  const parsed = parseNumericInput(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

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
  const snapshotMode = useToolSnapshotMode('sequential_analysis');
  const loadedSnapshot = useSnapshotViewStore(
    (s) => s.snapshots.sequential_analysis,
  ) as LoadedSnapshot<SequentialAnalysisSnapshotPayload> | null;
  const inSnapshotMode = isSnapshotMode(snapshotMode) && loadedSnapshot != null;

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
    inSnapshotMode && loadedSnapshot
      ? loadedSnapshot.manifest.node_colors
      : liveTrendsNodeColors;

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
  const {
    setLockedSchema,
    availableColumns,
    lockCurrentSchema,
    currentSchemaRef,
  } = useSchemaManagement({
    nodeId: activeNodeId,
    isLocked,
    workspaceId: currentWorkspaceId || undefined,
    getAuthHeaders,
    nodeData: nodeData ?? undefined,
    selectedNode: selectedNode ?? undefined,
  });

  const [liveResults, resultRef, setResultSafely, setResults] = useSafeResult<Record<string, unknown>>();
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
    setIsRunning: setIsAnalyzing,
    banner: sequentialWaitingBanner,
    hasActiveTask,
    clearResults,
  } = useAnalysisFeature<Record<string, unknown>>({
    analysisType: 'sequential_analysis',
    taskType: 'sequential_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef,
    fetchResult: async (taskId, headers) =>
      textApi.getSequentialAnalysisTaskResult(taskId, headers),
    fetchRequest: async (taskId, headers) =>
      textApi.getSequentialAnalysisTaskRequest(taskId, headers),
    onResultFetched: (resultData) => {
      if (!resultData) return;
      setDetachNodeName('');
      setSelectedPeriodIndices(new Set());
      lastClickedIndexRef.current = null;
      const resolvedChartType = isChartTypeOption((resultData as Record<string, unknown>)?.chart_type)
        ? (resultData as Record<string, unknown>).chart_type as ChartTypeOption
        : chartType;
      setResultSafely({
        ...(resultData as Record<string, unknown>),
        analysis_params: {
          ...((results as Record<string, unknown> | null)?.analysis_params as Record<string, unknown> ?? {}),
          ...((resultData as Record<string, unknown>)?.analysis_params as Record<string, unknown> ?? {}),
        },
        chart_type: resolvedChartType,
      });
      setChartType(resolvedChartType);
    },
    onHydratedResult: (resultPayload) => {
      if (!resultPayload) return;
      setDetachNodeName('');
      setSelectedPeriodIndices(new Set());
      lastClickedIndexRef.current = null;
      const hydratedParams = hydratedParamsRef.current;
      const enriched = {
        ...(resultPayload as Record<string, unknown>),
        analysis_params: {
          ...((resultPayload as Record<string, unknown>)?.analysis_params as Record<string, unknown> ?? {}),
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
      const resolvedChartType = isChartTypeOption((resultPayload as Record<string, unknown>)?.chart_type)
        ? (resultPayload as Record<string, unknown>).chart_type as ChartTypeOption
        : chartType;
      setResults({ ...enriched, chart_type: resolvedChartType });
      setChartType(resolvedChartType);
    },
    onHydratedRequest: async (requestPayload) => {
      const req = ((requestPayload as Record<string, unknown>)?.data ?? requestPayload) as Record<string, unknown> | null;
      if (!req) return;
      setHydratingSelection(true);
      const nodeIdStr = String(req.node_id || req.nodeId || '');
      const reqTimeColumn = typeof req.time_column === 'string' ? req.time_column : '';
      const reqColumnType = req.column_type === 'numeric' ? 'numeric' : 'datetime';
      const lockedNumericOrigin = reqColumnType === 'numeric' && typeof req.numeric_origin === 'number'
        ? req.numeric_origin : null;
      const lockedNumericInterval = reqColumnType === 'numeric' && typeof req.numeric_interval === 'number'
        ? req.numeric_interval : null;
      if (reqColumnType === 'numeric') {
        setNumericOriginInput(lockedNumericOrigin != null ? String(lockedNumericOrigin) : '');
        setNumericIntervalInput(lockedNumericInterval != null ? String(lockedNumericInterval) : '1');
      } else {
        setNumericOriginInput('');
        setNumericIntervalInput('1');
      }
      if (nodeIdStr && reqTimeColumn) {
        setNodeColumnSelections([{ nodeId: nodeIdStr, column: reqTimeColumn }]);
        setTimeColumn(reqTimeColumn);
      }
      const normalizedGroups = Array.isArray(req.group_by_columns)
        ? req.group_by_columns.filter((col: unknown): col is string => typeof col === 'string' && col.trim() !== '')
        : [];
      setGroupByColumns(normalizedGroups.length ? [...normalizedGroups] : []);
      const validFrequencies: SequentialFrequency[] = ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'];
      const reqFrequency = typeof req.frequency === 'string' ? (req.frequency as SequentialFrequency) : undefined;
      const lockedFrequency = reqFrequency && validFrequencies.includes(reqFrequency) ? reqFrequency : frequency;
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
          const info = await fetchNodeInfo({ queryClient, workspaceId: currentWorkspaceId, nodeId: nodeIdStr, getAuthHeaders });
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
    getExtraTaskIdCandidates: () => [(resultRef.current as Record<string, unknown> | null)?.metadata as Record<string, unknown> | undefined].map(m => m?.task_id as string | undefined),
    getClearTaskIdSources: () => [(resultRef.current as Record<string, unknown> | null)?.metadata as Record<string, unknown> | undefined].map(m => m?.task_id as string | undefined),
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
  // entering snapshot mode. The parameter inputs are disabled in
  // snapshot mode (via ``isLocked`` + ``inputsDisabled``), so once
  // synced the values stay frozen for the duration of the view.
  // Mirrors the live ``onHydratedRequest`` path, but reads from the
  // captured settings/result rather than the live task store.
  /* eslint-disable react-hooks/set-state-in-effect -- Snapshot load
     is a one-shot sync from the store; refactoring to render-time
     would duplicate dispatch logic across every render. */
  useEffect(() => {
    if (!inSnapshotMode || !loadedSnapshot) return;
    const settings = loadedSnapshot.payload.settings;
    const result = loadedSnapshot.payload.result;
    const analysisParams =
      (result?.analysis_params as Record<string, unknown> | undefined) ?? {};
    const tc =
      settings?.time_column ??
      (analysisParams.time_column as string | undefined) ??
      '';
    setTimeColumn(tc);
    const groups: string[] = Array.isArray(settings?.group_by_columns)
      ? (settings!.group_by_columns as string[])
      : Array.isArray(analysisParams.group_by_columns)
        ? (analysisParams.group_by_columns as string[])
        : [];
    setGroupByColumns([...groups]);
    const freq: SequentialFrequency =
      (settings?.frequency as SequentialFrequency | undefined) ??
      (analysisParams.frequency as SequentialFrequency | undefined) ??
      'daily';
    setFrequency(freq);
    const ct = isChartTypeOption(result?.chart_type) ? (result.chart_type as ChartTypeOption) : 'line';
    setChartType(ct);
    setCaseSensitive(
      typeof settings?.case_sensitive === 'boolean'
        ? settings.case_sensitive
        : typeof analysisParams.case_sensitive === 'boolean'
          ? (analysisParams.case_sensitive as boolean)
          : true,
    );
    const numericOrigin =
      settings?.numeric_origin ?? (analysisParams.numeric_origin as number | null | undefined);
    setNumericOriginInput(
      numericOrigin != null && Number.isFinite(numericOrigin) ? String(numericOrigin) : '',
    );
    const numericInterval =
      settings?.numeric_interval ?? (analysisParams.numeric_interval as number | null | undefined);
    setNumericIntervalInput(
      numericInterval != null && Number.isFinite(numericInterval) ? String(numericInterval) : '1',
    );
    const civ =
      settings?.custom_interval_value ??
      (analysisParams.custom_interval_value as number | null | undefined);
    setCustomIntervalValueInput(civ != null && Number.isFinite(civ) ? String(civ) : '1');
    const ciu =
      settings?.custom_interval_unit ??
      (analysisParams.custom_interval_unit as SequentialCustomIntervalUnit | null | undefined);
    setCustomIntervalUnit(isCustomIntervalUnit(ciu) ? ciu : 'minutes');
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
        .filter((column) => TIME_COMPATIBLE_TYPES.includes(column.dataType as (typeof TIME_COMPATIBLE_TYPES)[number]))
        .sort((a, b) => {
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
      const fromParams = (loadedSnapshot.payload.result?.analysis_params as Record<string, unknown> | undefined)?.time_column;
      return typeof fromParams === 'string' ? fromParams : '';
    }
    if (!activeNodeId) return '';
    const selection = nodeColumnSelections.find((s) => s.nodeId === activeNodeId);
    if (selection?.column) return selection.column;
    if (timeColumn) return timeColumn;
    const hydratedTime = ((results?.analysis_params as Record<string, unknown> | undefined)?.time_column as string | undefined) ?? '';
    return hydratedTime;
  })();

  const activeColumnInfo = timeCompatibleColumns.find((column) => column.name === activeTimeColumn);
  const activeColumnType = normalizeTypeName(activeColumnInfo?.dataType || (timeCompatibleColumns[0]?.dataType ?? 'datetime'));
  const derivedColumnType: 'datetime' | 'numeric' = inSnapshotMode && loadedSnapshot
    ? (((loadedSnapshot.payload.settings?.column_type ??
        (loadedSnapshot.payload.result?.analysis_params as Record<string, unknown> | undefined)?.column_type) === 'numeric')
      ? 'numeric'
      : 'datetime')
    : (NUMERIC_TYPE_SET.has(activeColumnType) ? 'numeric' : 'datetime');
  const numericOriginValue = derivedColumnType === 'numeric' ? parseNumericInput(numericOriginInput) : null;
  const numericIntervalValue = derivedColumnType === 'numeric' ? parseNumericInput(numericIntervalInput) : null;
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
    getServerParams: (request) => {
      const serverColumnType = typeof request.column_type === 'string' ? request.column_type : 'datetime';
      const serverFrequency = typeof request.frequency === 'string' ? request.frequency : 'year';
      const serverNumericOrigin = request.numeric_origin == null ? null : Number(request.numeric_origin);
      const serverNumericInterval = request.numeric_interval == null ? null : Number(request.numeric_interval);
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

      const serverCaseSensitive = typeof request.case_sensitive === 'boolean' ? request.case_sensitive : true;
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
      const currentSelection = nodeColumnSelections.find(s => s.nodeId === selectedNodeId);
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
    const currentSelection = nodeColumnSelections.find(s => s.nodeId === selectedNodeId);
    if (!currentSelection || currentSelection.column !== desired) {
      setNodeColumnSelections([{ nodeId: selectedNodeId, column: desired }]);
    }
  }, [inSnapshotMode, isLocked, hydratingSelection, selectedNodeId, timeColumnOptions, setNodeColumnSelections, nodeColumnSelections, timeColumn]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleAddGroupByColumn = () => {
    if (groupByColumns.length < 3) {
      setGroupByColumns([...groupByColumns, '']);
    }
  };

  const handleRemoveGroupByColumn = (index: number) => {
    setGroupByColumns(groupByColumns.filter((_, i) => i !== index));
  };

  const handleGroupByColumnChange = (index: number, value: string) => {
    const newColumns = [...groupByColumns];
    newColumns[index] = value;
    setGroupByColumns(newColumns);
  };

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
    handleAnalyze,
    handleClearResults,
    handleChartTypeChange,
    chartData,
    groupKeys,
    chartConfig,
    groupPointCounts,
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

  const clearPeriodSelection = () => {
    setSelectedPeriodIndices(new Set());
    lastClickedIndexRef.current = null;
  };

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
  const getSequentialNodeRowCount = (node: WorkspaceNodeLike) => {
    const shape = node.shape as unknown;
    if (Array.isArray(shape) && typeof shape[0] === 'number') return shape[0];
    return 0;
  };

  // Build the live ``SequentialAnalysisRequest`` from current state
  // for the capture-side ``settings.json`` payload. Returns null in
  // snapshot mode (the Save button is disabled there anyway). Plain
  // expression — the React Compiler memoizes per-render automatically.
  const captureRequest: (SequentialAnalysisRequest & { node_id?: string }) | null = (() => {
    if (inSnapshotMode) return null;
    if (!activeNodeId || !activeTimeColumn) return null;
    const validGroupBy = groupByColumns.filter((col) => col.trim() !== '');
    const isCustomDt = derivedColumnType === 'datetime' && frequency === 'custom';
    return {
      node_id: activeNodeId,
      time_column: activeTimeColumn,
      group_by_columns: validGroupBy.length ? validGroupBy : null,
      frequency,
      sort_by_time: true,
      column_type: derivedColumnType,
      numeric_origin: derivedColumnType === 'numeric' ? numericOriginValue : null,
      numeric_interval: derivedColumnType === 'numeric' ? numericIntervalValue : null,
      custom_interval_value: isCustomDt ? customIntervalValue : null,
      custom_interval_unit: isCustomDt ? customIntervalUnitValue : null,
      case_sensitive: caseSensitive,
    };
  })();

  const handleSaveSnapshot = useSequentialAnalysisSnapshotCapture({
    workspaceId: currentWorkspaceId ?? null,
    workspaceName: currentWorkspace?.name ?? currentWorkspaceId ?? '(workspace)',
    request: captureRequest,
    results: liveResults,
    selectedNode: liveCaptureNode,
    getNodeRowCount: getSequentialNodeRowCount,
    getAuthHeaders,
  });

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
    ? (value: ChartTypeOption) => { setChartType(value); }
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

  const getGroupKey = (row: Record<string, unknown>) => summaryGroupBy
    .map((column) => String(row[column] ?? ''))
    .join(' - ');

  const groupSizeByKey = (() => {
    if (!summaryGroupBy.length) return {} as Record<string, number>;

    const sizes: Record<string, number> = {};
    rawResultRows.forEach((row) => {
      const groupKey = getGroupKey(row);
      const count = row.sequential_count;
      const numericCount = typeof count === 'number' ? count : Number(count ?? 0);
      sizes[groupKey] = (sizes[groupKey] ?? 0) + numericCount;
    });
    return sizes;
  })();

  const passesMinGroupSize = (key: string) => !summaryGroupBy.length || (groupSizeByKey[key] ?? 0) >= minGroupSize;
  const filteredGroupKeys = groupKeys.filter((key) => passesMinGroupSize(key));
  const filteredOutGroupKeys = new Set(groupKeys.filter((key) => !passesMinGroupSize(key)));
  const invisibleGroupKeys = new Set([...hiddenKeys, ...filteredOutGroupKeys]);

  const canDetach = selectedPeriodIndices.size > 0
    && selectedPeriodIndices.size < chartData.length
    && filteredGroupKeys.length > 0;

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

  const isRowVisible = (row: Record<string, unknown>) => {
    if (!summaryGroupBy.length) return true;
    return !invisibleGroupKeys.has(getGroupKey(row));
  };

  const getTimeBucketKey = (row: Record<string, unknown>) => String(
    (row.time_period_formatted as string | number | undefined)
      ?? (row.time_period as string | number | undefined)
      ?? '',
  );

  const selectedTimeBucketKeys = new Set(
    Array.from(selectedPeriodIndices)
      .map((index) => String(chartData[index]?.time_period ?? ''))
      .filter((value) => value.length > 0),
  );

  const sumSequentialDocs = (rows: Array<Record<string, unknown>>) => rows.reduce((total, row) => {
    const count = row.sequential_count;
    return total + (typeof count === 'number' ? count : Number(count ?? 0));
  }, 0);

  const shownRows = rawResultRows.filter(isRowVisible);
  const chosenRows = shownRows.filter((row) => selectedTimeBucketKeys.has(getTimeBucketKey(row)));

  const totalPointCount = typeof results?.total_records === 'number'
    ? results.total_records
    : rawResultRows.length;
  const totalDocumentCount = typeof panelSelectedNodes[0]?.shape?.[0] === 'number'
    ? panelSelectedNodes[0].shape[0]
    : sumSequentialDocs(rawResultRows);
  const shownPointCount = shownRows.length;
  const shownDocumentCount = sumSequentialDocs(shownRows);
  const chosenPointCount = selectedPeriodIndices.size > 0 ? chosenRows.length : 0;
  const chosenDocumentCount = selectedPeriodIndices.size > 0 ? sumSequentialDocs(chosenRows) : 0;

  const resultsSummary = summaryTimeColumn
    ? (summaryColumnType === 'numeric'
        ? `Numeric bin counts for ${summaryTimeColumn}`
        : `Frequency of records grouped by ${summaryTimeColumn}`)
    : 'Aggregated frequency over time';

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
        }}
        actions={{
          onRun: () => {
            if (inSnapshotMode) return;
            void handleRunOrUpdate();
          },
          onClear: () => {
            if (inSnapshotMode) return;
            void handleClearResults();
          },
          runDisabled: inSnapshotMode || actionState.runDisabled || isLoading.operations || !activeTimeColumn,
          runDisabledReason: (() => {
            if (inSnapshotMode) return 'Disabled in snapshot view';
            if (isAnalyzing || isLoading.operations) return undefined;
            if (actionState.runDisabledReason) return actionState.runDisabledReason;
            if (!activeTimeColumn) return 'Select a time column to run';
            return undefined;
          })(),
          clearDisabled: inSnapshotMode || actionState.clearDisabled,
          isRunning: isAnalyzing,
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
              inSnapshotMode
                ? 'Viewing a saved snapshot — selection is frozen.'
                : undefined
            }
            displayNodeCount={displayNodeCount}
            onColumnChange={(nodeId, column) => {
              if (isLocked || inSnapshotMode) return;
              setNodeColumnSelections([{ nodeId, column }]);
              setTimeColumn(column);
            }}
            derivedColumnType={derivedColumnType}
            inputsDisabled={inSnapshotMode || (!isLocked && (isAnalyzing || isLoading.operations || !activeNodeId))}
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
            availableColumns={availableColumns}
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
        onConfirm={(format) => { void handleDownloadChart(format); }}
      />
    </div>
  );
};

export default SequentialAnalysisFeature;
